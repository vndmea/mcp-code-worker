import { spawn } from "node:child_process";

import type { ModelConfig } from "@mcp-code-worker/core";
import { toJSONSchema } from "zod";

import type {
  ModelInvocationRequest,
  ModelInvocationResult,
  ModelProvider
} from "../types/model-provider.js";

interface ClientUsagePayload {
  input_tokens?: number;
  output_tokens?: number;
}

interface ClientPayload {
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  subtype?: string;
  usage?: ClientUsagePayload;
}

const resolveClientCommand = (): string =>
  process.env.CW_WORKER_CLIENT_COMMAND?.trim() || "opencode";

const resolveConfiguredClientCommand = (config: ModelConfig): string =>
  process.env.CW_WORKER_CLIENT_COMMAND?.trim() ||
  config.clientCommand?.trim() ||
  resolveClientCommand();

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

const buildClientArgs = (
  config: ModelConfig,
  request: ModelInvocationRequest
): string[] => {
  const args = [
    "-p",
    "--tools",
    "",
    "--permission-mode",
    "dontAsk",
    "--output-format",
    "json",
    "--model",
    config.model
  ];

  if (request.systemPrompt) {
    args.push("--system-prompt", request.systemPrompt);
  }

  if (request.responseFormat === "json" && request.responseSchema) {
    args.push(
      "--json-schema",
      JSON.stringify(toJSONSchema(request.responseSchema))
    );
  }

  return args;
};

const parseClientPayload = (stdout: string): ClientPayload => {
  const lastNonEmptyLine = stdout
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .at(-1);

  if (!lastNonEmptyLine) {
    throw new Error("Local client worker produced no output.");
  }

  return JSON.parse(lastNonEmptyLine) as ClientPayload;
};

const tryParseClientPayload = (stdout: string): ClientPayload | null => {
  try {
    return parseClientPayload(stdout);
  } catch {
    return null;
  }
};

const summarizeClientError = (value: string): string =>
  value.replaceAll(/\s+/gu, " ").trim().slice(0, 300);

const buildClientExitError = (
  exitCode: number,
  stderr: string,
  stdout: string
): Error => {
  const payload = tryParseClientPayload(stdout);
  const message =
    (payload?.is_error && typeof payload.result === "string"
      ? payload.result
      : undefined) ??
    (stderr.trim().length > 0 ? stderr.trim() : undefined) ??
    (stdout.trim().length > 0 ? summarizeClientError(stdout) : undefined);

  return new Error(
    `Local client worker exited with code ${exitCode}${message ? `: ${message}` : ""}`
  );
};

const runClient = async (
  command: string,
  args: string[],
  prompt: string
): Promise<{ exitCode: number; stderr: string; stdout: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr
      });
    });

    child.stdin.end(prompt);
  });

export class LocalClientProvider implements ModelProvider {
  public readonly name = "client";

  public async invoke(
    config: ModelConfig,
    request: ModelInvocationRequest
  ): Promise<ModelInvocationResult> {
    if (request.mockResponse !== undefined) {
      return buildMockResult(config, request);
    }

    const clientCommand = resolveConfiguredClientCommand(config);
    const { exitCode, stderr, stdout } = await runClient(
      clientCommand,
      buildClientArgs(config, request),
      request.prompt
    );

    if (exitCode !== 0) {
      throw buildClientExitError(exitCode, stderr, stdout);
    }

    const payload = parseClientPayload(stdout);

    if (payload.is_error) {
      throw new Error(
        `Local client worker returned an error result${payload.result ? `: ${payload.result}` : ""}`
      );
    }

    const text =
      request.responseFormat === "json" && payload.structured_output !== undefined
        ? JSON.stringify(payload.structured_output)
        : payload.result ?? "";

    return {
      provider: config.provider,
      model: config.model,
      text,
      raw: payload,
      usage: {
        ...(payload.usage?.input_tokens !== undefined
          ? { inputTokens: payload.usage.input_tokens }
          : {}),
        ...(payload.usage?.output_tokens !== undefined
          ? { outputTokens: payload.usage.output_tokens }
          : {})
      }
    };
  }
}
