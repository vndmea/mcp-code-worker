import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { ModelConfig } from "@mcp-code-worker/core";

const {
  anthropicModelMock,
  createAnthropicMock,
  outputObjectMock,
  generateTextMock
} = vi.hoisted(() => ({
  anthropicModelMock: vi.fn((model: string) => ({ model })),
  createAnthropicMock: vi.fn(() => vi.fn((model: string) => ({ model }))),
  outputObjectMock: vi.fn((options: unknown) => options),
  generateTextMock: vi.fn()
}));

createAnthropicMock.mockImplementation(() => anthropicModelMock);

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: createAnthropicMock
}));

vi.mock("ai", () => ({
  Output: {
    object: outputObjectMock
  },
  generateText: generateTextMock
}));

import { AnthropicProvider } from "@mcp-code-worker/models";

const config: ModelConfig = {
  provider: "claude-compatible",
  model: "claude-3-5-sonnet-latest",
  baseURL: "https://api.anthropic.com"
};

describe("AnthropicProvider", () => {
  beforeEach(() => {
    anthropicModelMock.mockClear();
    createAnthropicMock.mockClear();
    outputObjectMock.mockClear();
    generateTextMock.mockReset();
  });

  it("falls back to plain text generation when structured output is unsupported", async () => {
    generateTextMock
      .mockRejectedValueOnce(new Error("structured output unavailable for this model"))
      .mockResolvedValueOnce({
        text: "{\"message\":\"fallback\",\"count\":2}",
        response: {
          id: "fallback"
        },
        usage: {
          inputTokens: 11,
          outputTokens: 7
        }
      });

    const provider = new AnthropicProvider();
    const result = await provider.invoke(config, {
      prompt: "Return JSON",
      responseFormat: "json",
      responseSchema: z.object({
        message: z.string(),
        count: z.number()
      })
    });

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(generateTextMock.mock.calls[0]?.[0]).toHaveProperty("output.schema");
    expect(generateTextMock.mock.calls[1]?.[0]).not.toHaveProperty("output");
    expect(result.text).toBe("{\"message\":\"fallback\",\"count\":2}");
    expect(result.usage).toEqual({
      inputTokens: 11,
      outputTokens: 7
    });
  });

  it("rethrows non-compatibility structured output failures", async () => {
    generateTextMock.mockRejectedValueOnce(new Error("401 Unauthorized"));

    const provider = new AnthropicProvider();

    await expect(
      provider.invoke(config, {
        prompt: "Return JSON",
        responseFormat: "json",
        responseSchema: z.object({
          ok: z.boolean()
        })
      })
    ).rejects.toThrow("401 Unauthorized");
  });

  it("does not pass maxOutputTokens when maxTokens is unset", async () => {
    generateTextMock.mockResolvedValueOnce({
      text: "ok",
      response: {
        id: "plain"
      },
      usage: {
        inputTokens: 5,
        outputTokens: 1
      }
    });

    const provider = new AnthropicProvider();
    await provider.invoke(config, {
      prompt: "Say ok"
    });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(generateTextMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "maxOutputTokens"
    );
  });
});
