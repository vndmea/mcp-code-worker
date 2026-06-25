import { createExecutionContextFromEnv, type ExecutionContext, type PatchApplyResult, type PatchInspection, type PatchProposal, type ValidationReport, PatchApplyResultSchema, writeAuditEvent } from "@agent-orchestrator/core";

import { inspectPatch } from "./patch-inspector.js";
import { runRepositoryValidation } from "../repository/validation.js";
import { runSafeCommand } from "../shell/safe-command.js";

export interface ApplyPatchOptions {
  allowWrite?: boolean;
  confirmApply?: boolean;
  dryRun?: boolean;
  runValidation?: {
    lint?: boolean;
    test?: boolean;
    typecheck?: boolean;
  };
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

const buildResult = ({
  mode,
  applied,
  proposal,
  inspection,
  validationReport,
  warnings = [],
  errors = []
}: {
  applied: boolean;
  errors?: string[];
  inspection: PatchInspection;
  mode: PatchApplyResult["mode"];
  proposal: PatchProposal;
  validationReport?: ValidationReport;
  warnings?: string[];
}): PatchApplyResult =>
  PatchApplyResultSchema.parse({
    mode,
    applied,
    patchId: proposal.id,
    touchedFiles: inspection.files.map((file) => file.path),
    inspection,
    validationReport,
    warnings,
    errors
  });

const auditPatchAction = async (
  context: ExecutionContext,
  mode: "blocked" | "dry-run" | "execute",
  proposal: PatchProposal,
  inspection: PatchInspection,
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
      inspection,
      patchId: proposal.id,
      touchedFiles: inspection.files.map((file) => file.path)
    }
  }, true);
};

export async function applyPatchProposal(
  context: ExecutionContext,
  proposal: PatchProposal,
  options: ApplyPatchOptions
): Promise<PatchApplyResult> {
  const inspection = await inspectPatch(context, proposal);

  if (!inspection.ok) {
    const result = buildResult({
      mode: "blocked",
      applied: false,
      proposal,
      inspection,
      errors: inspection.blockedReasons
    });
    await auditPatchAction(
      context,
      "blocked",
      proposal,
      inspection,
      result.warnings,
      result.errors
    );
    return result;
  }

  const commandContext = createCommandContext(context, Boolean(options.allowWrite));
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
        errors: [checkResult.stderr || "git apply --check failed."]
      });
      await auditPatchAction(
        context,
        "blocked",
        proposal,
        inspection,
        result.warnings,
        result.errors
      );
      return result;
    }

    const result = buildResult({
      mode: "dry-run",
      applied: false,
      proposal,
      inspection
    });
    await auditPatchAction(
      context,
      "dry-run",
      proposal,
      inspection,
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
      errors: ["Patch application requires --confirm-apply."]
    });
    await auditPatchAction(
      context,
      "blocked",
      proposal,
      inspection,
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
      errors: [applyResult.stderr || "git apply failed."]
    });
    await auditPatchAction(
      context,
      "blocked",
      proposal,
      inspection,
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
      ? ["Patch applied but validation failed; manual review required."]
      : [];
  const result = buildResult({
    mode: "execute",
    applied: true,
    proposal,
    inspection,
    validationReport,
    warnings
  });
  await auditPatchAction(
    context,
    "execute",
    proposal,
    inspection,
    result.warnings,
    result.errors
  );

  return result;
}
