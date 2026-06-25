import { randomUUID } from "node:crypto";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type {
  AgentTask,
  ExecutionContext,
  ToolExecutionResult,
  WorkerCapabilityProfile,
  WorkflowState
} from "@agent-orchestrator/core";
import {
  createExecutionContextFromEnv,
  writeAuditEvent
} from "@agent-orchestrator/core";
import {
  assessWorkerTaskEligibility,
  resolveWorkerProfile
} from "@agent-orchestrator/models";

import { LeaderAgent } from "../leader/leader-agent.js";
import { createInitialWorkflowState } from "../leader/leader-state.js";
import { CodegenWorker } from "../workers/codegen-worker.js";
import { ReviewWorker } from "../workers/review-worker.js";
import { SummarizeWorker } from "../workers/summarize-worker.js";
import { TestWorker } from "../workers/test-worker.js";
import { runWorkerInterviewWorkflow } from "./worker-interview-workflow.js";

export interface LeaderWorkerWorkflowInput {
  context?: ExecutionContext;
  goal: string;
  requireProfile?: boolean;
  scope?: string;
  workerCapabilityProfile?: WorkerCapabilityProfile | null;
  workerId?: string;
}

export interface LeaderWorkerWorkflowOutput {
  finalResult: WorkflowState["finalResult"];
  state: WorkflowState;
}

const LeaderWorkerState = Annotation.Root({
  task: Annotation<WorkflowState["task"]>(),
  plan: Annotation<WorkflowState["plan"]>(),
  workerResults: Annotation<WorkflowState["workerResults"]>(),
  toolResults: Annotation<WorkflowState["toolResults"]>(),
  review: Annotation<WorkflowState["review"]>(),
  finalResult: Annotation<WorkflowState["finalResult"]>(),
  workerCapabilityProfile: Annotation<WorkflowState["workerCapabilityProfile"]>(),
  warnings: Annotation<WorkflowState["warnings"]>(),
  errors: Annotation<WorkflowState["errors"]>()
});

const buildToolResults = (
  context: ExecutionContext,
  state: WorkflowState,
  profile: WorkerCapabilityProfile | null
): ToolExecutionResult[] => [
  {
    toolName: "worker-capability-interview",
    status:
      profile === null
        ? "failure"
        : profile.status === "blocked"
          ? "failure"
          : profile.status === "limited"
            ? "dry-run"
            : "success",
    output: profile,
    metadata: {
      warningCount: state.warnings.length,
      workerId: profile?.workerId
    }
  },
  {
    toolName: "validate-worker-results",
    status: state.workerResults.length > 0 ? "success" : "failure",
    output: {
      reviewedWorkers: state.workerResults.length
    },
    metadata: {
      dryRun: context.dryRun
    }
  },
  {
    toolName: "write-policy",
    status:
      context.writePolicy.evaluate(context.rootDir).mode === "execute"
        ? "success"
        : "dry-run",
    output: {
      allowWrite: context.allowWrite
    },
    metadata: {}
  }
];

const buildProfileWarnings = (
  profile: WorkerCapabilityProfile,
  existingWarnings: string[]
): string[] =>
  profile.status === "active"
    ? existingWarnings
    : [
        ...existingWarnings,
        `Worker ${profile.workerId} is ${profile.status}.`,
        ...profile.warnings
      ];

export const runLeaderWorkerWorkflow = async (
  input: LeaderWorkerWorkflowInput
): Promise<LeaderWorkerWorkflowOutput> => {
  const context = input.context ?? createExecutionContextFromEnv();
  await writeAuditEvent(context, {
    actor: "workflow",
    action: "start",
    mode: context.dryRun ? "dry-run" : "execute",
    workflow: "leader-worker-workflow",
    inputSummary: input.goal,
    outputSummary: "Leader-worker workflow started.",
    warnings: [],
    errors: [],
    metadata: {
      requireProfile: input.requireProfile,
      scope: input.scope,
      workerId: input.workerId
    }
  });
  const leader = new LeaderAgent(context);
  const summarizeWorker = new SummarizeWorker(context);
  const codegenWorker = new CodegenWorker(context);
  const testWorker = new TestWorker(context);
  const reviewWorker = new ReviewWorker(context);
  const task: AgentTask = {
    id: randomUUID(),
    goal: input.goal,
    input: {
      scope: input.scope
    },
    constraints: [
      "Leader must review worker output before final acceptance.",
      "Dry-run mode applies unless writes are explicitly allowed."
    ],
    expectedOutput: "Structured final result",
    assignedRole: "leader",
    priority: "high",
    metadata: {
      workflow: "leader-worker-workflow"
    }
  };

  const initialState = createInitialWorkflowState(task);

  const runEligibleWorkers = async (
    state: WorkflowState
  ): Promise<Pick<WorkflowState, "warnings" | "workerResults">> => {
    const profile = state.workerCapabilityProfile;

    if (!profile) {
      return {
        workerResults: [],
        warnings: [
          ...state.warnings,
          "No worker capability profile was available, so worker execution was skipped."
        ]
      };
    }

    const workerDefinitions = [
      {
        taskType: "summarization" as const,
        agent: summarizeWorker
      },
      {
        taskType: "codegen" as const,
        agent: codegenWorker
      },
      {
        taskType: "test-generation" as const,
        agent: testWorker
      },
      {
        taskType: "review-lite" as const,
        agent: reviewWorker
      }
    ];

    const warnings = [...state.warnings];
    const executions = workerDefinitions
      .filter(({ taskType }) => {
        const eligibility = assessWorkerTaskEligibility(profile, taskType);

        if (!eligibility.allowed) {
          warnings.push(eligibility.reason);
          return false;
        }

        if (eligibility.requiresLeaderReview) {
          warnings.push(
            `Worker ${profile.workerId} is allowed for ${taskType}, but leader review is required.`
          );
        }

        return true;
      })
      .map(async ({ agent }) =>
        agent.execute({
          task: state.task,
          scope: input.scope,
          workerProfile: profile
        })
      );

    return {
      workerResults: await Promise.all(executions),
      warnings
    };
  };

  const app = new StateGraph(LeaderWorkerState)
    .addNode("create_plan", async (state) => ({
      ...state,
      plan: await leader.createPlan(state.task)
    }))
    .addNode("interview_worker", async (state) => {
      if (input.workerCapabilityProfile) {
        return {
          ...state,
          workerCapabilityProfile: input.workerCapabilityProfile,
          warnings: buildProfileWarnings(
            input.workerCapabilityProfile,
            state.warnings
          )
        };
      }

      const resolution = await resolveWorkerProfile({
        context,
        workerId: input.workerId,
        requireProfile: input.requireProfile
      });

      if (resolution.freshness.usable && resolution.profile) {
        return {
          ...state,
          workerCapabilityProfile: resolution.profile,
          warnings: buildProfileWarnings(resolution.profile, state.warnings)
        };
      }

      const interviewResult = await runWorkerInterviewWorkflow({
        context,
        workerId: resolution.workerId,
        modelConfig: context.workerModel
      });
      const sourceWarning =
        resolution.source === "missing"
          ? `Worker profile for ${resolution.workerId} was missing; ran a fresh interview for this invocation.`
          : resolution.source === "stale"
            ? `Worker profile for ${resolution.workerId} was stale; ran a fresh interview for this invocation.`
            : `Worker profile for ${resolution.workerId} was incompatible with the current worker model; ran a fresh interview for this invocation.`;

      return {
        ...state,
        workerCapabilityProfile: interviewResult.profile,
        warnings: buildProfileWarnings(interviewResult.profile, [
          ...state.warnings,
          sourceWarning
        ])
      };
    })
    .addNode("workers", async (state) => ({
      ...state,
      ...(await runEligibleWorkers(state))
    }))
    .addNode("validate", (state) => ({
      ...state,
      toolResults: buildToolResults(
        context,
        state,
        state.workerCapabilityProfile
      )
    }))
    .addNode("build_review", (state) => ({
      ...state,
      review: leader.buildReviewSummary(
        state.task,
        state.workerResults,
        state.toolResults
      )
    }))
    .addNode("finalize", async (state) => ({
      ...state,
      finalResult: await leader.finalize(state)
    }))
    .addEdge(START, "create_plan")
    .addEdge("create_plan", "interview_worker")
    .addEdge("interview_worker", "workers")
    .addEdge("workers", "validate")
    .addEdge("validate", "build_review")
    .addEdge("build_review", "finalize")
    .addEdge("finalize", END)
    .compile();

  const state = await app.invoke(initialState);
  await writeAuditEvent(context, {
    actor: "workflow",
    action: "complete",
    mode: context.dryRun ? "dry-run" : "execute",
    workflow: "leader-worker-workflow",
    inputSummary: input.goal,
    outputSummary: `Leader-worker workflow completed with ${state.workerResults.length} worker result(s).`,
    warnings: state.warnings,
    errors: state.errors,
    metadata: {
      finalStatus: state.finalResult?.status,
      workerId: state.workerCapabilityProfile?.workerId
    }
  });

  return {
    state,
    finalResult: state.finalResult
  };
};
