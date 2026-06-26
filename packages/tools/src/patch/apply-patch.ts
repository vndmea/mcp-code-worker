import {
  createExecutionContextFromEnv,
  type DirtyWorktree,
  type ExecutionContext,
  type PatchApplyResult,
  type PatchInspection,
  type PatchProposal,
  type ValidationReport,
  PatchApplyResultSchema,
  writeAuditEvent
} from "@agent-orchestrator/core";

import { inspectPatch } from "./patch-inspector.js";
import { hasBlockingDirtyWorktree, readDirtyWorktree } from "../repository/git-status.js";
import { runRepositoryValidation } from "../repository/validation.js";
import { runSafeCommand } from "../shell/safe-command.js";

export interface ApplyPatchOptions {
  allowWrite?: boolean;
  allowDirtyWorktree?: boolean;
  confirmApply?: boolean;
  dryRun?: boolean;
  runValidation?: {
    lint?: boolean;
    test?: boolean;
    typecheck?: boolean;
  };
  scope?: string;
}

const createCommandContext = (
  context: ExecutionContext,
  allowWrite = false
): ExecutionContext =>
  createExecutionContextFromEnv(process.env, {
    rootDir: context.rootDir,
    allowWrite,
    allowedCommands: context.allowedCommands,
    contextBudget: context.contextBudget,
    dryRun: false,
    leaderModel: context.leaderModel,
    logLevel: context.logLevel,
    serverName: context.serverName,
    serverVersion: context.serverVersion,
      workerModel: context.workerModel
  });

const listDirtyFiles = (dirtyWorktree: DirtyWorktree | undefined): string[] =>
  dirtyWorktree
    ? Array.from(
        new Set([
          ...dirtyWorktree.stagedFiles,
          ...dirtyWorktree.modifiedFiles,
          ...dirtyWorktree.untrackedFiles
        ])
      ).sort()
    : [];

const buildRollbackDetails = (
  inspection: PatchInspection
): Pick<
  NonNullable<PatchApplyResult["recovery"]>,
  "rollbackActions" | "rollbackCommands"
> => {
  const restoreTargets = inspection.files
    .filter((file) => file.changeType !== "add")
    .map((file) => file.path);
  const cleanTargets = inspection.files
    .filter((file) => file.changeType === "add")
    .map((file) => file.path);
  const rollbackActions: NonNullable<PatchApplyResult["recovery"]>["rollbackActions"] = [];
  const rollbackCommands: string[] = [];

  if (restoreTargets.length > 0) {
    rollbackActions.push({
      command: "git",
      args: ["restore", "--worktree", "--", ...restoreTargets]
    });
    rollbackCommands.push(
      `git restore --worktree -- ${restoreTargets.join(" ")}`
    );
  }

  if (cleanTargets.length > 0) {
    rollbackActions.push({
      command: "git",
      args: ["clean", "-f", "--", ...cleanTargets]
    });
    rollbackCommands.push(`git clean -f -- ${cleanTargets.join(" ")}`);
  }

  return {
    rollbackActions: rollbackActions.length > 0 ? rollbackActions : undefined,
    rollbackCommands
  };
};

const buildRecovery = (input: {
  dirtyWorktree: DirtyWorktree | undefined;
  inspection: PatchInspection;
  validationReport: ValidationReport | undefined;
}): PatchApplyResult["recovery"] => {
  const failedChecks =
    input.validationReport?.checks
      .filter((check) => check.status === "failure")
      .map((check) => check.name) ?? [];
  const dirtyFilesBeforeApply = listDirtyFiles(input.dirtyWorktree);
  const preApplyDirty = dirtyFilesBeforeApply.length > 0;
  const safeToRunRollbackCommands = !preApplyDirty;
  const rollbackDetails = safeToRunRollbackCommands
    ? buildRollbackDetails(input.inspection)
    : {
        rollbackActions: undefined,
        rollbackCommands: []
      };
  const manualRecoveryGuide = safeToRunRollbackCommands
    ? [
        `Review failed validation checks: ${failedChecks.join(", ") || "unknown"}.`,
        "The worktree was clean before patch application, so direct rollback guidance is included below.",
        rollbackDetails.rollbackCommands.length > 0
          ? `Run the rollback commands in order: ${rollbackDetails.rollbackCommands.join(" ; ")}`
          : "No direct rollback commands were generated; inspect touched files manually.",
        "Rerun deterministic validation after restoring the touched files."
      ]
    : [
        `Review failed validation checks: ${failedChecks.join(", ") || "unknown"}.`,
        "The worktree was already dirty before patch application, so automatic rollback commands are intentionally omitted.",
        `Compare the pre-apply dirty files with the touched patch files before restoring anything: ${dirtyFilesBeforeApply.join(", ") || "none"}.`,
        "Use git diff, git status, and selective restore/cleanup commands to recover only the patch-introduced changes."
      ];

  return {
    validationFailed: true,
    touchedFiles: input.inspection.files.map((file) => file.path),
    failedChecks,
    preApplyDirty,
    dirtyFilesBeforeApply,
    safeToRunRollbackCommands,
    rollbackActions: rollbackDetails.rollbackActions,
    rollbackCommands: rollbackDetails.rollbackCommands,
    manualRecoveryGuide
  };
};

const buildResult = ({
  mode,
  applied,
  proposal,
  inspection,
  dirtyWorktree,
  validationReport,
  recovery,
  warnings = [],
  errors = []
}: {
  applied: boolean;
  dirtyWorktree?: DirtyWorktree;
  errors?: string[];
  inspection: PatchInspection;
  mode: PatchApplyResult["mode"];
  proposal: PatchProposal;
  recovery?: PatchApplyResult["recovery"];
  validationReport?: ValidationReport;
  warnings?: string[];
}): PatchApplyResult =>
  PatchApplyResultSchema.parse({
    mode,
    applied,
    patchId: proposal.id,
    touchedFiles: inspection.files.map((file) => file.path),
    inspection,
    dirtyWorktree,
    validationReport,
    recovery,
    warnings,
    errors
  });

const auditPatchAction = async (
  context: ExecutionContext,
  mode: "blocked" | "dry-run" | "execute",
  proposal: PatchProposal,
  inspection: PatchInspection,
  dirtyWorktree: DirtyWorktree | undefined,
  recovery: PatchApplyResult["recovery"] | undefined,
  warnings: string[],
  errors: string[]
): Promise<void> => {
  await writeAuditEvent(context, {
    actor: "tool",
    action: "apply-patch",
    mode,
    tool: "applyPatchProposal",
    inputSummary: `Patch ${proposal.id}`,
    outputSummary:
      mode === "execute"
        ? "Patch application completed."
        : mode === "dry-run"
          ? "Patch application checked in dry-run mode."
          : "Patch application was blocked.",
    warnings,
    errors,
    metadata: {
      dirtyWorktree,
      inspection,
      patchId: proposal.id,
      recovery,
      touchedFiles: inspection.files.map((file) => file.path)
    }
  }, true);
};

export async function applyPatchProposal(
  context: ExecutionContext,
  proposal: PatchProposal,
  options: ApplyPatchOptions
): Promise<PatchApplyResult> {
  const inspection = await inspectPatch(context, proposal, {
    scope: options.scope
  });
  const dirtyWorktree = await readDirtyWorktree(context);

  if (!inspection.ok) {
    const result = buildResult({
      mode: "blocked",
      applied: false,
      proposal,
      inspection,
      dirtyWorktree,
      errors: inspection.blockedReasons
    });
    await auditPatchAction(
      context,
      "blocked",
      proposal,
      inspection,
      dirtyWorktree,
      undefined,
      result.warnings,
      result.errors
    );
    return result;
  }

  if (hasBlockingDirtyWorktree(dirtyWorktree) && !options.allowDirtyWorktree) {
    const result = buildResult({
      mode: "blocked",
      applied: false,
      proposal,
      inspection,
      dirtyWorktree,
      errors: [
        "Dirty worktree detected. Re-run with --allow-dirty-worktree only after reviewing local changes."
      ]
    });
    await auditPatchAction(
      context,
      "blocked",
      proposal,
      inspection,
      dirtyWorktree,
      undefined,
      result.warnings,
      result.errors
    );
    return result;
  }

  const commandContext = createCommandContext(context, Boolean(options.allowWrite));
  const dirtyWarnings =
    hasBlockingDirtyWorktree(dirtyWorktree) && options.allowDirtyWorktree
      ? ["Dirty worktree allowed explicitly; manual review required."]
      : [];
  const dryRunRequested = options.dryRun === true || !options.allowWrite;
  if (dryRunRequested) {
    const checkResult = await runSafeCommand(
      "git apply --check --verbose -",
      commandContext,
      {
        stdin: proposal.unifiedDiff,
        maxOutputBytes: 120_000,
        timeoutMs: 120_000
      }
    );

    if (checkResult.code !== 0) {
      const result = buildResult({
        mode: "blocked",
        applied: false,
        proposal,
        inspection,
        dirtyWorktree,
        errors: [
          checkResult.stderr || checkResult.stdout || "git apply --check failed."
        ]
      });
      await auditPatchAction(
        context,
        "blocked",
        proposal,
        inspection,
        dirtyWorktree,
        undefined,
        result.warnings,
        result.errors
      );
      return result;
    }

    const result = buildResult({
      mode: "dry-run",
      applied: false,
      proposal,
      inspection,
      dirtyWorktree,
      warnings: dirtyWarnings
    });
    await auditPatchAction(
      context,
      "dry-run",
      proposal,
      inspection,
      dirtyWorktree,
      undefined,
      result.warnings,
      result.errors
    );
    return result;
  }

  if (!options.confirmApply) {
    const result = buildResult({
      mode: "blocked",
      applied: false,
      proposal,
      inspection,
      dirtyWorktree,
      errors: ["Patch application requires --confirm-apply."]
    });
    await auditPatchAction(
      context,
      "blocked",
      proposal,
      inspection,
      dirtyWorktree,
      undefined,
      result.warnings,
      result.errors
    );
    return result;
  }

  const applyResult = await runSafeCommand("git apply --verbose -", commandContext, {
    stdin: proposal.unifiedDiff,
    maxOutputBytes: 120_000,
    timeoutMs: 120_000
  });

  if (applyResult.code !== 0) {
    const result = buildResult({
        mode: "blocked",
        applied: false,
        proposal,
        inspection,
        dirtyWorktree,
        errors: [applyResult.stderr || applyResult.stdout || "git apply failed."]
      });
      await auditPatchAction(
        context,
        "blocked",
        proposal,
        inspection,
        dirtyWorktree,
        undefined,
        result.warnings,
        result.errors
      );
    return result;
  }

  const validationReport =
    options.runValidation &&
    (options.runValidation.typecheck ||
      options.runValidation.lint ||
      options.runValidation.test)
      ? await runRepositoryValidation(commandContext, {
          typecheck: options.runValidation.typecheck,
          lint: options.runValidation.lint,
          test: options.runValidation.test
        })
      : undefined;
  const warnings =
    validationReport && !validationReport.ok
      ? [...dirtyWarnings, "Patch applied but validation failed; manual review required."]
      : dirtyWarnings;
  const recovery =
    validationReport && !validationReport.ok
      ? buildRecovery({
          dirtyWorktree,
          inspection,
          validationReport
        })
      : undefined;
  const result = buildResult({
    mode: "execute",
    applied: true,
    proposal,
    inspection,
    dirtyWorktree,
    validationReport,
    recovery,
    warnings
  });
  await auditPatchAction(
    context,
    "execute",
    proposal,
    inspection,
    dirtyWorktree,
    recovery,
    result.warnings,
    result.errors
  );

  return result;
}
