import type {
  ExecutionContext,
  RepositoryContextPack,
  ValidationReport,
  WorkerTaskType
} from "@mcp-code-worker/core";
import { runRepositoryValidation } from "@mcp-code-worker/tools";

import type { HostWorkerWorkflowOutput } from "./host-worker-workflow.js";
import { runHostWorkerWorkflow } from "./host-worker-workflow.js";

export interface WorkflowValidationOptions {
  lint?: boolean;
  test?: boolean;
  typecheck?: boolean;
}

export const prepareRepositoryWorkflowRuntime = async (input: {
  buildRepositoryContext: () => Promise<RepositoryContextPack>;
  context: ExecutionContext;
  repositoryContext?: RepositoryContextPack;
  validate?: WorkflowValidationOptions;
}): Promise<{
  repositoryContext: RepositoryContextPack;
  scope: string | undefined;
  validationReport: ValidationReport;
}> => {
  const repositoryContext =
    input.repositoryContext ?? (await input.buildRepositoryContext());
  const scope = repositoryContext.scope;
  const validationReport = await runRepositoryValidation(input.context, {
    typecheck: input.validate?.typecheck,
    lint: input.validate?.lint,
    test: input.validate?.test,
    scope
  });

  return {
    repositoryContext,
    scope,
    validationReport
  };
};

export const runRepositoryScopedWorkerTask = async (input: {
  additionalTaskInput?: Record<string, unknown>;
  context: ExecutionContext;
  files?: string[];
  goal: string;
  repositoryContext: RepositoryContextPack;
  requireProfile?: boolean;
  strictFiles?: boolean;
  taskType: Exclude<WorkerTaskType, "patch-generation">;
  workerId?: string;
}): Promise<HostWorkerWorkflowOutput> =>
  runHostWorkerWorkflow({
    additionalTaskInput: input.additionalTaskInput,
    context: input.context,
    files: input.files,
    goal: input.goal,
    repositoryContext: input.repositoryContext,
    requireProfile: input.requireProfile,
    scope: input.repositoryContext.scope,
    strictFiles: input.strictFiles,
    taskType: input.taskType,
    workerId: input.workerId
  });
