import type { ModelConfig } from "@mcp-code-worker/core";
import type * as z from "zod";

export interface ModelInvocationRequest {
  prompt: string;
  systemPrompt?: string;
  responseFormat?: "text" | "json";
  responseSchema?: z.ZodType<unknown>;
  mockResponse?: unknown;
  metadata?: Record<string, unknown>;
}

export interface ModelInvocationResult {
  provider: string;
  model: string;
  text: string;
  raw?: unknown;
  usage?: {
    cachedInputTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    reasoningOutputTokens?: number;
  };
}

export interface ModelProvider {
  readonly name: string;
  invoke(
    config: ModelConfig,
    request: ModelInvocationRequest
  ): Promise<ModelInvocationResult>;
}
