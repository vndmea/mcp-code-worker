import { randomUUID } from "node:crypto";
import { extname } from "node:path";

import { z } from "zod";

import {
  PatchProposalSchema,
  RepositoryContextPackSchema,
  ValidationReportSchema,
  WorkerCapabilityProfileSchema,
  type ExecutionContext,
  type PatchProposal,
  type RepositoryContextPack,
  type ValidationReport,
  type WorkerCapability,
  type WorkerCapabilityProfile
} from "@agent-orchestrator/core";
import { ModelRouter, invokeStructured } from "@agent-orchestrator/models";

const PatchGenerationInputSchema = z.object({
  errorLog: z.string().optional(),
  fixResult: z.unknown().optional(),
  goal: z.string().min(1),
  repositoryContext: RepositoryContextPackSchema,
  reviewResult: z.unknown().optional(),
  scope: z.string().optional(),
  validationReport: ValidationReportSchema.optional(),
  workerId: z.string().min(1),
  workerProfile: WorkerCapabilityProfileSchema.nullable().optional()
});

const capability: WorkerCapability = {
  name: "patch-generation-worker",
  description: "Generates structured patch proposals for later inspection and gated apply.",
  inputSchema: PatchGenerationInputSchema,
  outputSchema: PatchProposalSchema,
  supportedTaskTypes: ["patch-generation"],
  preferredModel: "worker",
  costTier: "medium"
};

export interface PatchGenerationInput {
  errorLog?: string;
  fixResult?: unknown;
  goal: string;
  repositoryContext: RepositoryContextPack;
  reviewResult?: unknown;
  scope?: string;
  validationReport?: ValidationReport;
  workerId: string;
  workerProfile?: WorkerCapabilityProfile | null;
}

export interface PatchGenerationResult {
  errors: string[];
  proposal: PatchProposal;
  structuredOutputOk: boolean;
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

export const buildFallbackPatchProposal = (
  input: {
    goal?: string;
    scope?: string;
  },
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
      workflow: "patch-generation-worker",
      workerId,
      scope: input.scope
    }
  });
};

const buildCandidatePatchProposal = (
  input: PatchGenerationInput
): PatchProposal => {
  const patchTarget = buildFallbackUnifiedDiff(input.repositoryContext);

  return PatchProposalSchema.parse({
    id: randomUUID(),
    title: `Candidate patch for ${input.goal}`,
    summary: "Structured candidate patch proposal for manual inspection and gated application.",
    rationale: [
      "The patch is scoped to the selected repository context and must still pass inspect/apply gates.",
      "Deterministic validation remains required after any successful application."
    ],
    unifiedDiff: patchTarget.diffText,
    files: [
      {
        path: patchTarget.path,
        changeType: "modify",
        summary: "Add a minimal candidate patch for review.",
        riskLevel: "low"
      }
    ],
    risks: [
      "Candidate patch still requires manual review.",
      "Repository validation may fail after apply and should be reviewed."
    ],
    validationPlan: ["Run deterministic validation before and after any write-enabled apply."],
    generatedAt: new Date().toISOString(),
    source: {
      workflow: "patch-generation-worker",
      workerId: input.workerId,
      scope: input.scope
    }
  });
};

export class PatchGenerationWorker {
  private readonly capability = capability;
  private readonly router: ModelRouter;

  public constructor(private readonly context: ExecutionContext) {
    this.router = new ModelRouter(context.leaderModel, context.workerModel);
  }

  public async generateProposal(
    input: PatchGenerationInput
  ): Promise<PatchGenerationResult> {
    const candidateProposal = buildCandidatePatchProposal(input);
    const fallbackProposal = buildFallbackPatchProposal(
      {
        goal: input.goal,
        scope: input.scope
      },
      input.repositoryContext,
      input.workerId
    );
    const routed = input.workerProfile
      ? this.router.routeWorkerTask(
          this.capability.supportedTaskTypes[0] ?? "patch-generation",
          input.workerProfile
        )
      : this.router.route("worker");
    const invocation = await invokeStructured({
      provider: routed.provider,
      config: routed.config,
      schema: PatchProposalSchema,
      prompt: [
        "Return JSON matching the PatchProposal schema.",
        "Do not claim the patch has already been applied.",
        `Goal: ${input.goal}`,
        input.scope ? `Scope: ${input.scope}` : "Scope: repository-wide",
        input.errorLog ? `Error log:\n${input.errorLog}` : "Error log: not provided",
        input.validationReport
          ? `Validation report:\n${JSON.stringify(input.validationReport, null, 2).slice(0, 2_000)}`
          : "Validation report: not provided",
        `Review result:\n${summarizeUnknown(input.reviewResult)}`,
        `Fix result:\n${summarizeUnknown(input.fixResult)}`,
        `Repository context:\n${JSON.stringify(input.repositoryContext, null, 2).slice(0, 4_000)}`
      ].join("\n\n"),
      mockResponse: candidateProposal,
      metadata: {
        scope: input.scope,
        workerId: input.workerId,
        capability: this.capability.name
      },
      maxAttempts: 1
    });

    return {
      proposal: invocation.ok ? invocation.data : fallbackProposal,
      structuredOutputOk: invocation.ok,
      errors: invocation.ok ? [] : invocation.errors
    };
  }
}
