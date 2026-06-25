import { randomUUID } from "node:crypto";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type {
  AgentTask,
  ExecutionContext,
  RepositoryContextPack,
  ToolExecutionResult,
  ValidationReport
} from "@agent-orchestrator/core";
import { createExecutionContextFromEnv } from "@agent-orchestrator/core";
import {
  buildRepositoryContextPack,
  readRepositoryFile,
  runRepositoryValidation
} from "@agent-orchestrator/tools";

import { LeaderAgent } from "../leader/leader-agent.js";
import { createInitialWorkflowState } from "../leader/leader-state.js";
import { CodegenWorker } from "../workers/codegen-worker.js";
import { TestWorker } from "../workers/test-worker.js";
import { runPatchProposalWorkflow } from "./patch-proposal-workflow.js";

export interface FixErrorWorkflowInput {
  context?: ExecutionContext;
  errorLog?: string;
  errorLogFile?: string;
  proposePatch?: boolean;
  scope?: string;
  validate?: {
    lint?: boolean;
    test?: boolean;
    typecheck?: boolean;
  };
}

export interface FixErrorWorkflowOutput {
  candidateFixPlan: string[];
  leaderReview: Awaited<ReturnType<LeaderAgent["review"]>>;
  repositoryContext: RepositoryContextPack;
  rootCauseAnalysis: string;
  patchInspection?: Awaited<ReturnType<typeof runPatchProposalWorkflow>>["inspection"];
  patchProposal?: Awaited<ReturnType<typeof runPatchProposalWorkflow>>["proposal"];
  suggestedPatchArtifact: string;
  validationReport: ValidationReport;
}

const FixErrorState = Annotation.Root({
  task: Annotation<ReturnType<typeof createInitialWorkflowState>["task"]>(),
  plan: Annotation<ReturnType<typeof createInitialWorkflowState>["plan"]>(),
  workerResults: Annotation<ReturnType<typeof createInitialWorkflowState>["workerResults"]>(),
  toolResults: Annotation<ReturnType<typeof createInitialWorkflowState>["toolResults"]>(),
  review: Annotation<ReturnType<typeof createInitialWorkflowState>["review"]>(),
  finalResult: Annotation<ReturnType<typeof createInitialWorkflowState>["finalResult"]>(),
  workerCapabilityProfile: Annotation<ReturnType<typeof createInitialWorkflowState>["workerCapabilityProfile"]>(),
  warnings: Annotation<ReturnType<typeof createInitialWorkflowState>["warnings"]>(),
  errors: Annotation<ReturnType<typeof createInitialWorkflowState>["errors"]>()
});

export const runFixErrorWorkflow = async (
  input: FixErrorWorkflowInput
): Promise<FixErrorWorkflowOutput> => {
  const context = input.context ?? createExecutionContextFromEnv();
  const leader = new LeaderAgent(context);
  const codegenWorker = new CodegenWorker(context);
  const testWorker = new TestWorker(context);
  const errorLog = input.errorLog ??
    (input.errorLogFile
      ? await readRepositoryFile(input.errorLogFile, context.rootDir, 20_000)
      : "");
  const repositoryContext = await buildRepositoryContextPack(context, {
    rootDir: context.rootDir,
    scope: input.scope
  });
  const validationReport = await runRepositoryValidation(context, {
    typecheck: input.validate?.typecheck,
    lint: input.validate?.lint,
    test: input.validate?.test,
    scope: input.scope
  });
  const validationChecks = validationReport.checks.map((check) => ({
    toolName: `validation:${check.name}`,
    status:
      check.status === "success"
        ? "success"
        : check.status === "failure"
          ? "failure"
          : "dry-run",
    output: check,
    metadata: {}
  })) satisfies ToolExecutionResult[];
  const task: AgentTask = {
    id: randomUUID(),
    goal: "Analyze an error log and propose a safe fix plan",
    input: {
      errorLog,
      errorLogFile: input.errorLogFile,
      repositoryContext,
      validationReport,
      scope: input.scope
    },
    constraints: [
      "Do not apply writes automatically.",
      "Return a root-cause analysis with validation guidance."
    ],
    expectedOutput: "Root cause analysis and candidate fix plan",
    assignedRole: "leader",
    priority: "high",
    metadata: {
      workflow: "fix-error-workflow"
    }
  };

  const app = new StateGraph(FixErrorState)
    .addNode("create_plan", async (state) => ({
      ...state,
      plan: await leader.createPlan(state.task)
    }))
    .addNode("workers", async (state) => ({
      ...state,
      workerResults: await Promise.all([
        codegenWorker.execute({ task: state.task, scope: input.scope }),
        testWorker.execute({ task: state.task })
      ])
    }))
    .addNode("validate", (state) => ({
      ...state,
      toolResults: [
        {
          toolName: "error-log-check",
          status: errorLog.trim() ? "success" : "failure",
          output: {
            hasErrorLog: Boolean(errorLog.trim())
          },
          metadata: {}
        },
        ...validationChecks
      ]
    }))
    .addEdge(START, "create_plan")
    .addEdge("create_plan", "workers")
    .addEdge("workers", "validate")
    .addEdge("validate", END)
    .compile();

  const state = await app.invoke(createInitialWorkflowState(task));
  const leaderReview = await leader.review(
    state.task,
    state.workerResults,
    state.toolResults
  );
  const patchResult = input.proposePatch
    ? await runPatchProposalWorkflow({
        context,
        errorLog,
        fixResult: {
          candidateFixPlan: [
            "Reproduce the failing command in dry-run-safe conditions.",
            "Limit the fix to the provided scope.",
            "Run deterministic validation after the change."
          ]
        },
        goal: input.scope
          ? `Fix issues within ${input.scope}`
          : "Fix the supplied repository issue",
        repositoryContext,
        scope: input.scope
      })
    : undefined;

  return {
    rootCauseAnalysis: errorLog.trim()
      ? "The supplied error log should be traced from failing validation back to the owning package boundary."
      : "No error log was provided, so the analysis is incomplete.",
    candidateFixPlan: [
      "Reproduce the failing command in dry-run-safe conditions.",
      "Limit the fix to the provided scope.",
      "Run deterministic validation after the change."
    ],
    ...(patchResult
      ? {
          patchProposal: patchResult.proposal,
          patchInspection: patchResult.inspection
        }
      : {}),
    repositoryContext,
    suggestedPatchArtifact: "candidate-patch-plan.md",
    validationReport,
    leaderReview
  };
};
