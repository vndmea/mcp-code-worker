import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createExecutionContextFromEnv,
  getCwWorkspaceFilePath
} from "@mcp-code-worker/core";
import {
  createDefaultWorkerEvaluationSuite,
  runHostWorkerWorkflow,
  runWorkerInterviewWorkflow
} from "@mcp-code-worker/graph";

const createWorkspace = async (): Promise<string> => {
  const rootDir = await mkdtemp(join(tmpdir(), "cw-worker-interview-"));
  await mkdir(join(rootDir, "packages", "core", "src"), { recursive: true });
  await writeFile(
    join(rootDir, "packages", "core", "src", "generateId.ts"),
    "export const generateId = () => 'id';\n",
    "utf8"
  );
  await writeFile(
    join(rootDir, "packages", "core", "src", "schemaMinimum.ts"),
    "export const schemaMinimum = 1;\n",
    "utf8"
  );
  return rootDir;
};

const registerWorker = async (
  rootDir: string,
  registrationWorkerId = workerId
): Promise<void> => {
  const registryPath = getCwWorkspaceFilePath(rootDir, "workers.json");
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(
    registryPath,
    JSON.stringify(
      {
        version: 1,
        workers: [
          {
            workerId: registrationWorkerId,
            provider: "mock",
            model: "gpt-5.4-mini",
            enabled: true,
            tags: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );
};

const createContext = () =>
  createExecutionContextFromEnv(undefined, {
    dryRun: true,
    allowWrite: false
  });

const workerId = "mock:interview-worker";

describe("worker interview workflow", () => {
  it("generates a qualified capability profile for the default mock worker", async () => {
    const result = await runWorkerInterviewWorkflow({
      context: createContext(),
      workerId
    });

    expect(result.status).toBe("qualified");
    expect(result.profile.supportedTaskTypes).toContain("codegen");
    expect(result.profile.supportedTaskTypes).toContain("doc-generation");
    expect(result.profile.supportedTaskTypes).toContain("risk-analysis");
    expect(result.profile.supportedTaskTypes).toContain("code-understanding");
    expect(result.profile.supportedTaskTypes).toContain("validation-fix");
    expect(result.profile.routingPolicy.allowCodegen).toBe(true);
    expect(result.profile.admission?.passed).toBe(true);
    expect(result.profile.portrait?.repoGrounding).toBeGreaterThan(0.7);
    expect(result.profile.taskScores?.reviewLite).toBeGreaterThan(0.7);
    expect(result.profile.evidence?.repoGroundedCases).toContain(
      "structured-output"
    );
    expect(result.profile.evidence?.repoGroundedCases).toContain(
      "review-grounding"
    );
    expect(result.profile.evidence?.repoGroundedCases).toContain(
      "evidence-sufficiency"
    );
    expect(result.taskResults).toHaveLength(9);
  });

  it("marks workers not-qualified when structured output handling fails admission", async () => {
    const result = await runWorkerInterviewWorkflow({
      context: createContext(),
      workerId,
      simulatedResponses: {
        "structured-output": "this is not valid json"
      }
    });

    expect(result.status).toBe("not-qualified");
    expect(result.profile.score.structuredOutput).toBeLessThan(0.45);
    expect(result.profile.admission?.passed).toBe(false);
    expect(result.profile.admission?.blockingReasons.join("\n")).toMatch(
      /Structured output|No worker task type/u
    );
    expect(result.warnings.join("\n")).toContain("structured-output");
  });

  it("marks provider invocation failures as non-persistable interview results", async () => {
    const result = await runWorkerInterviewWorkflow({
      context: createContext(),
      workerId,
      simulatedResponses: {
        summarization: new Error("connection refused")
      }
    });

    expect(result.interviewDiagnostics.outcome).toBe("provider-error");
    expect(result.persistenceAdvice.canPersist).toBe(false);
    expect(result.persistenceAdvice.reason).toContain(
      "provider invocation failures"
    );
    expect(result.profile.admission?.passed).toBe(false);
    expect(
      result.taskResults.some(
        (task) => task.failureKind === "provider-invocation"
      )
    ).toBe(true);
  });

  it("marks review-heavy tasks unsupported without blocking the whole worker when review grounding is generic", async () => {
    const result = await runWorkerInterviewWorkflow({
      context: createContext(),
      workerId,
      simulatedResponses: {
        "review-grounding": {
          answer: "Review the files and inspect the implementation.",
          findings: ["Possible issue.", "Needs more context."],
          referencedFiles: [
            "packages/core/src/exportXml.ts",
            "packages/core/src/exportXml.ts"
          ],
          confidence: 0.91
        }
      }
    });

    expect(result.profile.supportedTaskTypes).not.toContain("review-lite");
    expect(result.profile.supportedTaskTypes).not.toContain("risk-analysis");
    expect(
      result.taskResults.find((task) => task.type === "review-grounding")?.score
    ).toBeLessThan(0.6);
    expect(result.profile.admission?.passed).toBe(true);
    expect(result.status).toBe("not-qualified");
    expect(result.profile.unsupportedTaskTypes).toContain("review-lite");
    expect(result.profile.unsupportedTaskTypes).toContain("risk-analysis");
    expect(result.profile.evidence?.genericAnswerCases).toContain(
      "review-grounding"
    );
  });

  it("marks summarization and review tasks unsupported without blocking the whole worker when mandatory evidence is missing but the worker guesses", async () => {
    const result = await runWorkerInterviewWorkflow({
      context: createContext(),
      workerId,
      simulatedResponses: {
        "evidence-sufficiency": {
          decision: "yes",
          reason: "export looks fine so the fix is probably present",
          missingFiles: [],
          confidence: 0.94
        }
      }
    });

    expect(result.profile.supportedTaskTypes).not.toContain("summarization");
    expect(result.profile.supportedTaskTypes).not.toContain("review-lite");
    expect(result.profile.supportedTaskTypes).not.toContain("risk-analysis");
    expect(result.profile.admission?.passed).toBe(true);
    expect(result.status).toBe("not-qualified");
    expect(result.profile.unsupportedTaskTypes).toContain("summarization");
    expect(result.profile.unsupportedTaskTypes).toContain("doc-generation");
    expect(result.profile.evidence?.genericAnswerCases).toContain(
      "evidence-sufficiency"
    );
  });

  it("routes weak code understanding to not-qualified with code-understanding unsupported", async () => {
    const result = await runWorkerInterviewWorkflow({
      context: createContext(),
      workerId,
      simulatedResponses: {
        "code-understanding": {
          behavior: "Inspect the code for the implementation details.",
          risk: "There may be a possible issue depending on context.",
          confidence: 0.91
        }
      }
    });

    expect(result.profile.supportedTaskTypes).not.toContain(
      "code-understanding"
    );
    expect(result.profile.admission?.passed).toBe(true);
    expect(result.status).toBe("not-qualified");
    expect(result.profile.unsupportedTaskTypes).toContain("code-understanding");
  });

  it("accepts code understanding risk only when it gives a concrete input and result", async () => {
    const result = await runWorkerInterviewWorkflow({
      context: createContext(),
      workerId,
      simulatedResponses: {
        "code-understanding": {
          behavior:
            "packages/math/src/sumValidated.ts filters the input array to finite numbers and returns their sum.",
          risk: 'packages/math/src/sumValidated.ts silently ignores ["5", NaN], so it can return 0 instead of reporting invalid input.',
          confidence: 0.78
        }
      }
    });

    const task = result.taskResults.find(
      (entry) => entry.type === "code-understanding"
    );
    expect(task?.score).toBeGreaterThan(0.8);
    expect(task?.findings).not.toContain(
      "Code understanding risk was too generic."
    );
    expect(result.profile.supportedTaskTypes).toContain("code-understanding");
  });

  it("limits routing when code generation quality is too low", async () => {
    const rootDir = await createWorkspace();
    await registerWorker(rootDir);
    const interview = await runWorkerInterviewWorkflow({
      context: createContext(),
      workerId,
      simulatedResponses: {
        codegen: {
          code: "export const bad: any = 1;",
          confidence: 0.95
        }
      }
    });
    const workflow = await runHostWorkerWorkflow({
      context: createExecutionContextFromEnv(undefined, {
        dryRun: true,
        allowWrite: false,
        rootDir
      }),
      files: ["packages/core/src/generateId.ts"],
      goal: "Generate implementation drafts",
      taskType: "codegen",
      workerId,
      workerCapabilityProfile: interview.profile
    });

    expect(interview.status).toBe("not-qualified");
    expect(interview.profile.routingPolicy.allowCodegen).toBe(false);
    expect(workflow.workerResult).toBeNull();
    expect(workflow.warnings.join("\n")).toContain("not qualified for codegen");
  });

  it("prevents not-qualified workers from receiving production tasks", async () => {
    const rootDir = await createWorkspace();
    await registerWorker(rootDir);
    const interview = await runWorkerInterviewWorkflow({
      context: createContext(),
      workerId,
      simulatedResponses: {
        "structured-output": "bad",
        summarization: "bad"
      }
    });
    const workflow = await runHostWorkerWorkflow({
      context: createExecutionContextFromEnv(undefined, {
        dryRun: true,
        allowWrite: false,
        rootDir
      }),
      files: ["packages/core/src/generateId.ts"],
      goal: "Draft tests for workflow routing",
      taskType: "review-lite",
      workerId,
      workerCapabilityProfile: interview.profile
    });

    expect(interview.status).toBe("not-qualified");
    expect(workflow.workerResult).toBeNull();
    expect(workflow.warnings.join("\n")).toContain("not-qualified");
    expect(workflow.finalResult.status).toBe("needs_review");
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
      suite.tasks.find((task) => task.id === "summarization")?.prompt
    ).toContain(
      "at least one nextSteps item must name packages/runtime/src/readProfile.ts"
    );
    expect(
      suite.tasks.find((task) => task.id === "review-grounding")?.prompt
    ).toContain("packages/core/src/normalizeNode.ts");
    expect(
      suite.tasks.find((task) => task.id === "evidence-sufficiency")?.prompt
    ).toContain("insufficient");
    expect(
      suite.tasks.find((task) => task.id === "evidence-sufficiency")?.prompt
    ).toContain(
      "confidence in answering the original repository question reliably"
    );
    expect(
      suite.tasks.find((task) => task.id === "code-understanding")?.prompt
    ).toContain("packages/math/src/sumValidated.ts");
    expect(
      suite.tasks.find((task) => task.id === "code-understanding")?.prompt
    ).toContain("explicitly naming packages/math/src/sumValidated.ts");
    expect(
      suite.tasks.find((task) => task.id === "code-understanding")?.prompt
    ).toContain("trigger input pattern");
    expect(
      suite.tasks.find((task) => task.id === "code-understanding")?.prompt
    ).toContain('silently ignores ["5", NaN]');
    expect(suite.tasks.find((task) => task.id === "codegen")?.prompt).toContain(
      "Target file: packages/validation/src/validateScore.ts"
    );
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
