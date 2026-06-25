import { randomUUID } from "node:crypto";
import { extname } from "node:path";

import {
  createExecutionContextWithWorkerModel,
  PatchInspectionSchema,
  PatchProposalSchema,
  type ExecutionContext,
  type PatchInspection,
  type PatchProposal,
  type RepositoryContextPack,
  resolveExecutionContext,
  writeAuditEvent
} from "@agent-orchestrator/core";
import {
  invokeStructured,
  ModelRouter,
  resolveWorkerModel,
  resolveWorkerProfile
} from "@agent-orchestrator/models";
import {
  buildRepositoryContextPack,
  inspectPatch
} from "@agent-orchestrator/tools";

export interface PatchProposalWorkflowInput {
  context?: ExecutionContext;
  errorLog?: string;
  fixResult?: unknown;
  goal?: string;
  repositoryContext?: RepositoryContextPack;
  requireProfile?: boolean;
  reviewResult?: unknown;
  scope?: string;
  workerId?: string;
}

export interface PatchProposalWorkflowOutput {
  inspection: PatchInspection;
  proposal: PatchProposal;
  warnings: string[];
}

const summarizeUnknown = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    return JSON.stringify(value, null, 2).slice(0, 2_000);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value.toString();
  }

  return "";
};

const pickPatchTarget = (
  repositoryContext: RepositoryContextPack
) =>
  repositoryContext.selectedFiles.find((file) =>
    [".ts", ".tsx", ".js", ".jsx", ".json", ".md"].includes(extname(file.path))
  ) ?? repositoryContext.selectedFiles[0];

const buildFallbackUnifiedDiff = (
  repositoryContext: RepositoryContextPack
): { diffText: string; path: string } => {
  const target = pickPatchTarget(repositoryContext);

  if (!target) {
    return {
      path: "README.md",
      diffText: [
        "diff --git a/README.md b/README.md",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -0,0 +1 @@",
        "+Patch proposal requires manual repository context review."
      ].join("\n")
    };
  }

  const firstLine = target.content.split(/\r?\n/u)[0] ?? "";
  if (!firstLine) {
    return {
      path: target.path,
      diffText: [
        `diff --git a/${target.path} b/${target.path}`,
        `--- a/${target.path}`,
        `+++ b/${target.path}`,
        "@@ -0,0 +1 @@",
        "+// Candidate patch generated for manual review."
      ].join("\n")
    };
  }

  return {
    path: target.path,
    diffText: [
      `diff --git a/${target.path} b/${target.path}`,
      `--- a/${target.path}`,
      `+++ b/${target.path}`,
      "@@ -1,1 +1,2 @@",
      "+// Candidate patch generated for manual review.",
      ` ${firstLine}`
    ].join("\n")
  };
};

const buildFallbackProposal = (
  input: PatchProposalWorkflowInput,
  repositoryContext: RepositoryContextPack,
  workerId?: string
): PatchProposal => {
  const patchTarget = buildFallbackUnifiedDiff(repositoryContext);
  const goal =
    input.goal ??
    "Generate a safe candidate patch proposal for manual review.";

  return PatchProposalSchema.parse({
    id: randomUUID(),
    title: `[PLACEHOLDER] ${goal}`,
    summary:
      "This is not an actionable fix. Structured patch generation failed, so the proposal is a blocked placeholder for manual review only.",
    rationale: [
      "Structured model output failed, so no trustworthy patch could be generated automatically.",
      "A human should inspect repository context, validation results, and fix guidance before drafting a real patch."
    ],
    unifiedDiff: patchTarget.diffText,
    files: [
      {
        path: patchTarget.path,
        changeType: "modify",
        summary: "Placeholder diff only; do not apply.",
        riskLevel: "medium"
      }
    ],
    risks: [
      "Placeholder proposal generated because structured model output failed.",
      "Patch is not actionable and requires manual review before any application attempt."
    ],
    validationPlan: [
      "Do not apply this placeholder patch.",
      "Regenerate or author a real patch before running deterministic validation."
    ],
    generatedAt: new Date().toISOString(),
    source: {
      workflow: "patch-proposal-workflow",
      workerId
    }
  });
};

export const runPatchProposalWorkflow = async (
  input: PatchProposalWorkflowInput
): Promise<PatchProposalWorkflowOutput> => {
  const context = input.context ?? await resolveExecutionContext();
  const repositoryContext =
    input.repositoryContext ??
    await buildRepositoryContextPack(context, {
      rootDir: context.rootDir,
      scope: input.scope
    });
  const warnings: string[] = [];
  const workerModelResolution = input.workerId
    ? await resolveWorkerModel({
        context,
        workerId: input.workerId
      })
    : undefined;
  const workerContext = workerModelResolution
    ? createExecutionContextWithWorkerModel(
        context,
        workerModelResolution.modelConfig
      )
    : context;
  const workerProfileResolution =
    input.workerId || input.requireProfile
      ? await resolveWorkerProfile({
          context: workerContext,
          modelConfig: workerContext.workerModel,
          workerId: workerModelResolution?.workerId,
          requireProfile: input.requireProfile
        })
      : undefined;
  const workerId =
    workerProfileResolution?.workerId ??
    workerModelResolution?.workerId ??
    ModelRouter.deriveWorkerId(workerContext.workerModel);
  const fallbackProposal = buildFallbackProposal(
    input,
    repositoryContext,
    workerId
  );
  const router = new ModelRouter(
    workerContext.leaderModel,
    workerContext.workerModel
  );
  const routed = workerProfileResolution?.profile
    ? router.routeWorkerTask("codegen", workerProfileResolution.profile)
    : router.route("worker");
  const invocation = await invokeStructured({
    provider: routed.provider,
    config: routed.config,
    schema: PatchProposalSchema,
    prompt: [
      "Return JSON matching the PatchProposal schema.",
      "Do not claim the patch has already been applied.",
      `Goal: ${input.goal ?? "Propose a safe patch."}`,
      input.scope ? `Scope: ${input.scope}` : "Scope: repository-wide",
      input.errorLog ? `Error log:\n${input.errorLog}` : "Error log: not provided",
      `Review result:\n${summarizeUnknown(input.reviewResult)}`,
      `Fix result:\n${summarizeUnknown(input.fixResult)}`,
      `Repository context:\n${JSON.stringify(repositoryContext, null, 2).slice(0, 4_000)}`
    ].join("\n\n"),
    mockResponse: fallbackProposal,
    metadata: {
      scope: input.scope,
      workerId
    },
    maxAttempts: 1
  });
  const proposal = invocation.ok ? invocation.data : fallbackProposal;
  let inspection = await inspectPatch(context, proposal);

  if (!invocation.ok) {
    warnings.push("Patch proposal is a fallback placeholder and must not be applied.");
    inspection = PatchInspectionSchema.parse({
      ...inspection,
      ok: false,
      blockedReasons: [
        "Patch proposal is a fallback placeholder and must not be applied.",
        ...inspection.blockedReasons,
        ...invocation.errors
      ]
    });
  }

  await writeAuditEvent(context, {
    actor: "workflow",
    action: "propose-patch",
    mode: context.dryRun ? "dry-run" : "execute",
    workflow: "patch-proposal-workflow",
    inputSummary: input.goal ?? input.scope ?? "patch proposal",
    outputSummary: inspection.ok
      ? "Patch proposal generated."
      : "Patch proposal generated but inspection blocked it.",
    warnings,
    errors: inspection.blockedReasons,
    metadata: {
      patchId: proposal.id,
      scope: input.scope,
      workerId
    }
  });

  return {
    proposal,
    inspection,
    warnings
  };
};
