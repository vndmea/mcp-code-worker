import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { ModelConfig } from "@agent-orchestrator/core";
import {
  MockModelProvider,
  invokeStructured,
  type ModelInvocationRequest,
  type ModelInvocationResult,
  type ModelProvider
} from "@agent-orchestrator/models";

const config: ModelConfig = {
  provider: "mock",
  model: "mock-model"
};

class SequenceProvider implements ModelProvider {
  public readonly name = "sequence";

  public calls = 0;

  public constructor(
    private readonly responses: Array<ModelInvocationResult | Error>
  ) {}

  public async invoke(
    _config: ModelConfig,
    _request: ModelInvocationRequest
  ): Promise<ModelInvocationResult> {
    const response = this.responses[this.calls];
    this.calls += 1;

    if (response instanceof Error) {
      throw response;
    }

    if (response) {
      return response;
    }

    const fallback = this.responses[this.responses.length - 1];
    if (!fallback || fallback instanceof Error) {
      throw new Error("No valid mock response configured.");
    }

    return fallback;
  }
}

const schema = z.object({
  message: z.string(),
  count: z.number().int()
});

describe("invokeStructured", () => {
  it("parses valid plain JSON", async () => {
    const provider = new SequenceProvider([
      {
        provider: "sequence",
        model: "mock-model",
        text: JSON.stringify({
          message: "ok",
          count: 2
        })
      }
    ]);

    const result = await invokeStructured({
      provider,
      config,
      schema,
      prompt: "Return JSON"
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        message: "ok",
        count: 2
      },
      attempts: 1
    });
  });

  it("parses JSON wrapped in markdown fences", async () => {
    const provider = new SequenceProvider([
      {
        provider: "sequence",
        model: "mock-model",
        text: '```json\n{"message":"ok","count":3}\n```'
      }
    ]);

    const result = await invokeStructured({
      provider,
      config,
      schema,
      prompt: "Return fenced JSON"
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.count).toBe(3);
  });

  it("returns a parse failure for invalid JSON", async () => {
    const provider = new SequenceProvider([
      {
        provider: "sequence",
        model: "mock-model",
        text: "not-json"
      }
    ]);

    const result = await invokeStructured({
      provider,
      config,
      schema,
      prompt: "Return invalid JSON"
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("failed to parse JSON");
  });

  it("returns a schema failure for mismatched JSON", async () => {
    const provider = new SequenceProvider([
      {
        provider: "sequence",
        model: "mock-model",
        text: JSON.stringify({
          message: "ok",
          count: "bad"
        })
      }
    ]);

    const result = await invokeStructured({
      provider,
      config,
      schema,
      prompt: "Return the wrong schema"
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("schema validation failed");
    expect(result.errors[0]).toContain("count");
  });

  it("retries on parse or validation failure", async () => {
    const provider = new SequenceProvider([
      {
        provider: "sequence",
        model: "mock-model",
        text: "bad-json"
      },
      {
        provider: "sequence",
        model: "mock-model",
        text: JSON.stringify({
          message: "retried",
          count: 4
        })
      }
    ]);

    const result = await invokeStructured({
      provider,
      config,
      schema,
      prompt: "Retry please",
      maxAttempts: 2
    });

    expect(provider.calls).toBe(2);
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.message).toBe("retried");
    expect(result.errors).toHaveLength(1);
  });

  it("preserves usage details from the provider response", async () => {
    const provider = new SequenceProvider([
      {
        provider: "sequence",
        model: "mock-model",
        text: JSON.stringify({
          message: "ok",
          count: 1
        }),
        usage: {
          inputTokens: 10,
          outputTokens: 20
        }
      }
    ]);

    const result = await invokeStructured({
      provider,
      config,
      schema,
      prompt: "Return usage"
    });

    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 20
    });
  });

  it("stays compatible with the mock provider", async () => {
    const provider = new MockModelProvider();
    const result = await invokeStructured({
      provider,
      config,
      schema,
      prompt: "Use mock response",
      mockResponse: {
        message: "mock",
        count: 7
      }
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        message: "mock",
        count: 7
      }
    });
  });
});
