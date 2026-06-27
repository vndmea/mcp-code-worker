import { describe, expect, it } from "vitest";

import { createExecutionContextFromEnv } from "@agent-orchestrator/core";
import {
  createDefaultWorkerEvaluationSuite,
  runWorkerInterviewWorkflow
} from "@agent-orchestrator/graph";
import { runLeaderWorkerWorkflow } from "./leader-worker-workflow.js";

const createContext = () =>
  createExecutionContextFromEnv(undefined, {
    dryRun: true,
    allowWrite: false
  });

describe("worker interview workflow", () => {
  it("generates an active capability profile for the default mock worker", async () => {
    const result = await runWorkerInterviewWorkflow({
      context: createContext()
    });

    expect(result.status).toBe("active");
    expect(result.profile.supportedTaskTypes).toContain("codegen");
    expect(result.profile.routingPolicy.allowCodegen).toBe(true);
    expect(result.profile.admission?.passed).toBe(true);
    expect(result.profile.portrait?.repoGrounding).toBeGreaterThan(0.7);
    expect(result.profile.taskScores?.reviewLite).toBeGreaterThan(0.7);
    expect(result.profile.evidence?.repoGroundedCases).toContain("structured-output");
    expect(result.taskResults).toHaveLength(7);
  });

  it("blocks workers that fail structured output handling", async () => {
    const result = await runWorkerInterviewWorkflow({
      context: createContext(),
      simulatedResponses: {
        "structured-output": "this is not valid json"
      }
    });

    expect(result.status).toBe("blocked");
    expect(result.profile.score.structuredOutput).toBeLessThan(0.45);
    expect(result.profile.admission?.passed).toBe(false);
    expect(result.profile.admission?.blockingReasons.join("\n")).toMatch(
      /Structured output|Repo grounding|No worker task type/u
    );
    expect(result.warnings.join("\n")).toContain("structured-output");
  });

  it("marks provider invocation failures as non-persistable interview results", async () => {
    const result = await runWorkerInterviewWorkflow({
      context: createContext(),
      simulatedResponses: {
        summarization: new Error("connection refused")
      }
    });

    expect(result.interviewDiagnostics.outcome).toBe("provider-error");
    expect(result.persistenceAdvice.canPersist).toBe(false);
    expect(result.persistenceAdvice.reason).toContain("provider invocation failures");
    expect(result.profile.admission?.passed).toBe(false);
    expect(result.taskResults.some((task) => task.failureKind === "provider-invocation")).toBe(true);
  });

  it("limits routing when code generation quality is too low", async () => {
    const interview = await runWorkerInterviewWorkflow({
      context: createContext(),
      simulatedResponses: {
        codegen: {
          code: "export const bad: any = 1;",
          confidence: 0.95
        }
      }
    });
    const workflow = await runLeaderWorkerWorkflow({
      context: createContext(),
      goal: "Generate implementation drafts",
      workerCapabilityProfile: interview.profile
    });

    expect(interview.status).toBe("limited");
    expect(interview.profile.routingPolicy.allowCodegen).toBe(false);
    expect(
      workflow.state.workerResults.some((result) => result.agentId === "worker.codegen")
    ).toBe(false);
    expect(workflow.state.workerResults.length).toBe(2);
    expect(workflow.state.warnings.join("\n")).toContain("not qualified for codegen");
  });

  it("prevents blocked workers from receiving production tasks", async () => {
    const interview = await runWorkerInterviewWorkflow({
      context: createContext(),
      simulatedResponses: {
        "structured-output": "bad",
        summarization: "bad"
      }
    });
    const workflow = await runLeaderWorkerWorkflow({
      context: createContext(),
      goal: "Draft tests for workflow routing",
      workerCapabilityProfile: interview.profile
    });

    expect(interview.status).toBe("blocked");
    expect(workflow.state.workerResults).toHaveLength(0);
    expect(workflow.state.warnings.join("\n")).toContain("blocked");
    expect(workflow.finalResult?.status).toBe("needs_review");
  });

  it("uses interview prompts with concrete fixtures and explicit field names", () => {
    const suite = createDefaultWorkerEvaluationSuite();

    expect(
      suite.tasks.find((task) => task.id === "structured-output")?.prompt
    ).toContain("packages/runtime/src/selectWorker.ts");
    expect(
      suite.tasks.find((task) => task.id === "scope-discipline")?.prompt
    ).toContain("packages/id/src/generateId.ts");
    expect(
      suite.tasks.find((task) => task.id === "summarization")?.prompt
    ).toContain("packages/runtime/src/readProfile.ts");
    expect(
      suite.tasks.find((task) => task.id === "code-understanding")?.prompt
    ).toContain("packages/math/src/sumValidated.ts");
    expect(
      suite.tasks.find((task) => task.id === "codegen")?.prompt
    ).toContain("Target file: packages/validation/src/validateScore.ts");
  });

  it("derives different prompt sets for different worker models", () => {
    const proSuite = createDefaultWorkerEvaluationSuite({
      workerId: "openai-compatible:deepseek-v4-pro"
    });
    const flashSuite = createDefaultWorkerEvaluationSuite({
      workerId: "openai-compatible:deepseek-v4-flash"
    });

    expect(proSuite.tasks).toHaveLength(flashSuite.tasks.length);
    expect(proSuite.tasks.map((task) => task.prompt)).not.toEqual(
      flashSuite.tasks.map((task) => task.prompt)
    );
  });
});
