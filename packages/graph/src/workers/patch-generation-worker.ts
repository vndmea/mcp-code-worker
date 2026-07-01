import { randomUUID } from "node:crypto";

import {
  PatchProposalSchema,
  type AgentResult,
  type AgentTask,
  type ExecutionContext,
  type PatchProposal,
  type RepositoryContextPack,
  type ValidationReport,
  type WorkerCapabilityProfile
} from "@mcp-code-worker/core";
import type { ModelStructuredOutputMode } from "@mcp-code-worker/models";

import {
  buildWorkerTaskContractResultOptions,
  getWorkerTaskContract
} from "../contracts/worker-task-contract.js";
import { WorkerAgent, type WorkerExecutionInput } from "./worker-agent.js";

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
  structuredOutputFallbackReason?: string;
  structuredOutputMode: ModelStructuredOutputMode;
  structuredOutputOk: boolean;
}

const asStructuredOutputMode = (value: unknown): ModelStructuredOutputMode =>
  value === "none" ||
  value === "native-json-schema" ||
  value === "prompt-only-json"
    ? value
    : "none";

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const buildPatchGenerationTask = (input: PatchGenerationInput): AgentTask => ({
  id: randomUUID(),
  goal: input.goal,
  input: {
    errorLog: input.errorLog,
    fixResult: input.fixResult,
    repositoryContext: input.repositoryContext,
    reviewResult: input.reviewResult,
    scope: input.scope,
    taskType: "patch-generation",
    validationReport: input.validationReport,
    workerId: input.workerId
  },
  constraints: [
    "Use only the host-selected repository context.",
    "Return a PatchProposal JSON object only.",
    "Never apply patches or claim validation passed without host evidence."
  ],
  expectedOutput: "Structured PatchProposal for deterministic host inspection.",
  assignedRole: "worker",
  priority: "high",
  metadata: {
    workflow: "patch-proposal-workflow"
  }
});

export class PatchGenerationWorker extends WorkerAgent {
  public constructor(context: ExecutionContext) {
    const contract = getWorkerTaskContract("patch-generation");

    super(context, contract.capability);
  }

  public async execute(input: WorkerExecutionInput): Promise<AgentResult> {
    const contract = getWorkerTaskContract("patch-generation");
    const options = buildWorkerTaskContractResultOptions(contract, input);

    return this.createResult({
      ...options,
      allowUnqualifiedExecution: input.allowUnqualifiedExecution,
      task: input.task,
      workerProfile: input.workerProfile
    });
  }

  public async generateProposal(
    input: PatchGenerationInput
  ): Promise<PatchGenerationResult> {
    const result = await this.execute({
      allowUnqualifiedExecution: !input.workerProfile,
      task: buildPatchGenerationTask(input),
      scope: input.scope,
      workerProfile: input.workerProfile
    });

    return {
      proposal: PatchProposalSchema.parse(result.output),
      structuredOutputFallbackReason:
        typeof result.metadata.structuredOutputFallbackReason === "string"
          ? result.metadata.structuredOutputFallbackReason
          : undefined,
      structuredOutputMode: asStructuredOutputMode(
        result.metadata.structuredOutputMode
      ),
      structuredOutputOk: result.metadata.structuredOutputOk === true,
      errors: asStringArray(result.metadata.structuredOutputErrors)
    };
  }
}
