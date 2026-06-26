import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { ModelConfig } from "@agent-orchestrator/core";

const {
  chatMock,
  createOpenAIMock,
  outputObjectMock,
  generateTextMock
} = vi.hoisted(() => ({
  chatMock: vi.fn((model: string) => ({ model })),
  createOpenAIMock: vi.fn(() => ({
    chat: vi.fn((model: string) => ({ model }))
  })),
  outputObjectMock: vi.fn((options: unknown) => options),
  generateTextMock: vi.fn()
}));

createOpenAIMock.mockImplementation(() => ({
  chat: chatMock
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: createOpenAIMock
}));

vi.mock("ai", () => ({
  Output: {
    object: outputObjectMock
  },
  generateText: generateTextMock
}));

import { AiSdkProvider } from "@agent-orchestrator/models";

const config: ModelConfig = {
  provider: "openai-compatible",
  model: "deepseek-v4-pro",
  baseURL: "https://api.deepseek.com"
};

describe("AiSdkProvider", () => {
  beforeEach(() => {
    chatMock.mockClear();
    createOpenAIMock.mockClear();
    outputObjectMock.mockClear();
    generateTextMock.mockReset();
  });

  it("falls back to plain text generation when structured output is unsupported", async () => {
    generateTextMock
      .mockRejectedValueOnce(new Error("This response_format type is unavailable now"))
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

    const provider = new AiSdkProvider();
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

    const provider = new AiSdkProvider();

    await expect(
      provider.invoke(config, {
        prompt: "Return JSON",
        responseFormat: "json",
        responseSchema: z.object({
          ok: z.boolean()
        })
      })
    ).rejects.toThrow("401 Unauthorized");

    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });
});
