import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import type { ModelConfig } from "@mcp-code-worker/core";
import { toJSONSchema } from "zod";

import type {
  ModelInvocationRequest,
  ModelInvocationResult,
  ModelProvider
} from "../types/model-provider.js";
import {
  inspectConfiguredCodexCommand,
  type CodexCommandInspection
} from "./codex-command.js";
import { parseCodexEventStream } from "./codex-event-stream.js";

const summarizePrompt = (prompt: string): string =>
  prompt.replaceAll(/\s+/gu, " ").trim().slice(0, 160);

const buildMockResult = (
  config: ModelConfig,
  request: ModelInvocationRequest
): ModelInvocationResult => {
  const body =
    request.mockResponse ??
    (request.responseFormat === "json"
      ? {
          message: "mock-json-response",
          summary: summarizePrompt(request.prompt)
        }
      : `MOCK:${summarizePrompt(request.prompt)}`);

  return {
    provider: config.provider,
    model: config.model,
    text: typeof body === "string" ? body : JSON.stringify(body, null, 2),
    raw: body,
    usage: {
      inputTokens: request.prompt.length,
      outputTokens:
        typeof body === "string"
          ? body.length
          : JSON.stringify(body).length
    }
  };
};

const buildCodexPrompt = (request: ModelInvocationRequest): string =>
  request.systemPrompt
    ? [
        "System instructions:",
        request.systemPrompt,
        "",
        "User request:",
        request.prompt
      ].join("\n")
    : request.prompt;

const buildCodexArgs = (
  config: ModelConfig,
  responseSchemaPath?: string
): string[] => {
  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check"
  ];

  if (config.model.trim().length > 0) {
    args.push("--model", config.model);
  }

  if (responseSchemaPath) {
    args.push("--output-schema", responseSchemaPath);
  }

  return args;
};

const buildResolutionSummary = (inspection: CodexCommandInspection): string =>
  `configured=${inspection.configuredCommand ?? "(default)"} resolved=${inspection.resolvedPath ?? "(not found)"} source=${inspection.source}`;

const buildResolutionError = (inspection: CodexCommandInspection): Error =>
  new Error(
    `Codex command resolution failed: ${inspection.compatibility.message} (${buildResolutionSummary(inspection)})`
  );

const buildSpawnError = (
  error: Error,
  inspection: CodexCommandInspection
): Error =>
  new Error(
    `Codex worker failed to start: ${error.message} (${buildResolutionSummary(inspection)})`
  );

const summarizeCodexError = (value: string): string =>
  value.replaceAll(/\s+/gu, " ").trim().slice(0, 300);

const buildExitError = (
  exitCode: number,
  stderr: string,
  stdout: string
): Error => {
  try {
    const parsed = parseCodexEventStream(stdout);
    const message =
      parsed.error ??
      (stderr.trim().length > 0 ? stderr.trim() : undefined) ??
      (stdout.trim().length > 0 ? summarizeCodexError(stdout) : undefined);
    return new Error(
      `Codex worker exited with code ${exitCode}${message ? `: ${message}` : ""}`
    );
  } catch {
    const message =
      stderr.trim().length > 0 ? stderr.trim() : summarizeCodexError(stdout);
    return new Error(
      `Codex worker exited with code ${exitCode}${message ? `: ${message}` : ""}`
    );
  }
};

const runCodex = async (
  inspection: CodexCommandInspection,
  args: string[],
  prompt: string
): Promise<{ exitCode: number; stderr: string; stdout: string }> =>
  await new Promise((resolve, reject) => {
    const child = spawn(inspection.resolvedPath ?? inspection.command, args, {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdin.setDefaultEncoding("utf8");
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(
        buildSpawnError(
          error instanceof Error ? error : new Error(String(error)),
          inspection
        )
      );
    });
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr
      });
    });

    child.stdin.end(prompt);
  });

const withResponseSchemaFile = async <T>(
  request: ModelInvocationRequest,
  run: (responseSchemaPath?: string) => Promise<T>
): Promise<T> => {
  if (!(request.responseFormat === "json" && request.responseSchema)) {
    return run();
  }

  const schemaDir = await mkdtemp(join(tmpdir(), "cw-codex-schema-"));
  const schemaPath = join(schemaDir, "response-schema.json");

  try {
    await writeFile(
      schemaPath,
      JSON.stringify(toJSONSchema(request.responseSchema)),
      "utf8"
    );
    return await run(schemaPath);
  } finally {
    await rm(schemaDir, { force: true, recursive: true });
  }
};

export class CodexProvider implements ModelProvider {
  public readonly name = "codex";

  public async invoke(
    config: ModelConfig,
    request: ModelInvocationRequest
  ): Promise<ModelInvocationResult> {
    if (request.mockResponse !== undefined) {
      return buildMockResult(config, request);
    }

    const commandInspection = await inspectConfiguredCodexCommand(config, {
      checkCompatibility: false
    });

    if (!commandInspection.resolvedPath) {
      throw buildResolutionError(commandInspection);
    }

    return await withResponseSchemaFile(request, async (responseSchemaPath) => {
      const { exitCode, stderr, stdout } = await runCodex(
        commandInspection,
        buildCodexArgs(config, responseSchemaPath),
        buildCodexPrompt(request)
      );

      if (exitCode !== 0) {
        throw buildExitError(exitCode, stderr, stdout);
      }

      const parsed = parseCodexEventStream(stdout);

      if (parsed.error) {
        throw new Error(`Codex worker returned an error event: ${parsed.error}`);
      }

      return {
        provider: config.provider,
        model: config.model,
        text: parsed.text,
        raw: parsed.events,
        usage: {
          ...(parsed.usage?.inputTokens !== undefined
            ? { inputTokens: parsed.usage.inputTokens }
            : {}),
          ...(parsed.usage?.cachedInputTokens !== undefined
            ? { cachedInputTokens: parsed.usage.cachedInputTokens }
            : {}),
          ...(parsed.usage?.outputTokens !== undefined
            ? { outputTokens: parsed.usage.outputTokens }
            : {}),
          ...(parsed.usage?.reasoningOutputTokens !== undefined
            ? { reasoningOutputTokens: parsed.usage.reasoningOutputTokens }
            : {})
        }
      };
    });
  }
}
