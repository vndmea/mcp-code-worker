import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";

import type { ModelConfig } from "@mcp-code-worker/core";

import type {
  ModelInvocationRequest,
  ModelInvocationResult,
  ModelProvider
} from "../types/model-provider.js";

const extractUsage = (
  usage: Awaited<ReturnType<typeof generateText>>["usage"] | undefined
): ModelInvocationResult["usage"] => ({
  ...(usage?.inputTokens !== undefined
    ? { inputTokens: usage.inputTokens }
    : {}),
  ...(usage?.outputTokens !== undefined
    ? { outputTokens: usage.outputTokens }
    : {})
});

const isStructuredOutputCompatibilityError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /response_format|json_schema|json tool|structured output/iu.test(message);
};

export class AnthropicProvider implements ModelProvider {
  public readonly name = "anthropic";

  public async invoke(
    config: ModelConfig,
    request: ModelInvocationRequest
  ): Promise<ModelInvocationResult> {
    const client = createAnthropic({
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      ...(config.baseURL ? { baseURL: config.baseURL } : {})
    });

    if (request.responseFormat === "json" && request.responseSchema) {
      try {
        const result = await generateText({
          model: client(config.model),
          system: request.systemPrompt,
          prompt: request.prompt,
          temperature: config.temperature,
          ...(config.maxTokens !== undefined
            ? { maxOutputTokens: config.maxTokens }
            : {}),
          output: Output.object({
            schema: request.responseSchema
          })
        });

        return {
          provider: config.provider,
          model: config.model,
          text: JSON.stringify(result.output),
          raw: {
            output: result.output,
            response: result.response
          },
          usage: extractUsage(result.usage)
        };
      } catch (error) {
        if (!isStructuredOutputCompatibilityError(error)) {
          throw error;
        }
      }
    }

    const result = await generateText({
      model: client(config.model),
      system: request.systemPrompt,
      prompt: request.prompt,
      temperature: config.temperature,
      ...(config.maxTokens !== undefined
        ? { maxOutputTokens: config.maxTokens }
        : {})
    });

    return {
      provider: config.provider,
      model: config.model,
      text: result.text,
      raw: result.response,
      usage: extractUsage(result.usage)
    };
  }
}
