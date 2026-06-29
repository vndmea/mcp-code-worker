import { describe, expect, it } from "vitest";

import { createExecutionContextFromEnv } from "./execution-context.js";

describe("createExecutionContextFromEnv", () => {
  it("does not set a worker maxTokens limit by default", () => {
    const context = createExecutionContextFromEnv({
      WORKER_MODEL_PROVIDER: "openai-compatible",
      WORKER_MODEL_NAME: "deepseek-v4-pro"
    });

    expect(context.workerModel.maxTokens).toBeUndefined();
  });
});
