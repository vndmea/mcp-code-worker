import type { ModelConfig } from "@agent-orchestrator/core";
import type * as z from "zod";

import type {
  ModelInvocationResult,
  ModelProvider
} from "../types/model-provider.js";

export interface StructuredInvocationOptions<T> {
  provider: ModelProvider;
  config: ModelConfig;
  schema: z.ZodType<T>;
  prompt: string;
  systemPrompt?: string;
  mockResponse?: unknown;
  metadata?: Record<string, unknown>;
  maxAttempts?: number;
}

export interface StructuredInvocationSuccess<T> {
  ok: true;
  data: T;
  rawText: string;
  raw?: unknown;
  attempts: number;
  usage?: ModelInvocationResult["usage"];
  errors: string[];
}

export type StructuredInvocationFailureKind =
  | "provider-invocation"
  | "json-parse"
  | "schema-validation";

export interface StructuredInvocationFailure {
  ok: false;
  data?: undefined;
  rawText: string;
  raw?: unknown;
  attempts: number;
  usage?: ModelInvocationResult["usage"];
  errors: string[];
  failureKind: StructuredInvocationFailureKind;
}

export type StructuredInvocationResult<T> =
  | StructuredInvocationSuccess<T>
  | StructuredInvocationFailure;

const fencedJsonPattern = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu;

export const extractJsonCandidate = (text: string): string => {
  const trimmed = text.trim();
  const fencedMatch = fencedJsonPattern.exec(trimmed);

  return fencedMatch?.[1]?.trim() ?? trimmed;
};

export const tryParseJson = (text: string): unknown =>
  JSON.parse(extractJsonCandidate(text)) as unknown;

export const formatZodError = (error: z.ZodError): string[] =>
  error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "root";
    return `${path}: ${issue.message}`;
  });

const formatUnknownError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export async function invokeStructured<T>(
  options: StructuredInvocationOptions<T>
): Promise<StructuredInvocationResult<T>> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 1);
  const errors: string[] = [];
  let rawText = "";
  let raw: unknown;
  let usage: ModelInvocationResult["usage"];
  let failureKind: StructuredInvocationFailureKind = "provider-invocation";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await options.provider.invoke(options.config, {
        prompt: options.prompt,
        systemPrompt: options.systemPrompt,
        responseFormat: "json",
        responseSchema: options.schema,
        mockResponse: options.mockResponse,
        metadata: options.metadata
      });

      rawText = result.text;
      raw = result.raw;
      usage = result.usage;

      let parsed: unknown;
      try {
        parsed = tryParseJson(result.text);
      } catch (error) {
        failureKind = "json-parse";
        errors.push(`Attempt ${attempt}: failed to parse JSON: ${formatUnknownError(error)}`);
        continue;
      }

      const schemaResult = options.schema.safeParse(parsed);
      if (!schemaResult.success) {
        failureKind = "schema-validation";
        errors.push(
          `Attempt ${attempt}: schema validation failed: ${formatZodError(schemaResult.error).join("; ")}`
        );
        continue;
      }

      return {
        ok: true,
        data: schemaResult.data,
        rawText: result.text,
        raw: result.raw,
        attempts: attempt,
        usage: result.usage,
        errors
      };
    } catch (error) {
      errors.push(`Attempt ${attempt}: provider invocation failed: ${formatUnknownError(error)}`);
      return {
        ok: false,
        rawText,
        raw,
        attempts: attempt,
        usage,
        errors,
        failureKind: "provider-invocation"
      };
    }
  }

  return {
    ok: false,
    rawText,
    raw,
    attempts: maxAttempts,
    usage,
    errors,
    failureKind
  };
}
