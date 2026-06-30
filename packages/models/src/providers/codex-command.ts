import { spawn } from "node:child_process";

import {
  looksLikeFileSystemPath,
  normalizeCommandInput,
  type ModelConfig
} from "@mcp-code-worker/core";

import {
  resolveCommandOnPath,
  type LocalClientCommandSource
} from "./local-client-command.js";

export interface InspectCodexCommandOptions {
  checkCompatibility?: boolean;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface CodexCommandResolution {
  command: string;
  configuredCommand: string | null;
  source: LocalClientCommandSource;
}

export interface CodexCompatibilityResult {
  checked: boolean;
  message: string;
  status: "pass" | "warning" | "fail";
  stderr?: string;
  stdout?: string;
}

export interface CodexCommandInspection {
  command: string;
  compatibility: CodexCompatibilityResult;
  configuredCommand: string | null;
  isPathLike: boolean;
  resolvedPath: string | null;
  source: LocalClientCommandSource;
  status: "pass" | "warning" | "fail";
}

const EXPECTED_CODEX_TOKENS = [
  "codex exec",
  "--json",
  "--output-schema",
  "--model"
];

export const resolveCodexCommandResolution = (
  config: Pick<ModelConfig, "clientCommand">
): CodexCommandResolution => {
  const configuredCommand = config.clientCommand?.trim();

  return {
    command: normalizeCommandInput(configuredCommand || "codex"),
    configuredCommand: configuredCommand
      ? normalizeCommandInput(configuredCommand)
      : null,
    source: configuredCommand ? "configured" : "default"
  };
};

const runCodexHelpProbe = async (
  resolvedCommand: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<CodexCompatibilityResult> =>
  await new Promise((resolve) => {
    const child = spawn(resolvedCommand, ["exec", "--help"], {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: CodexCompatibilityResult): void => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({
        checked: true,
        message: `Compatibility probe timed out after ${timeoutMs}ms.`,
        status: "warning",
        stderr,
        stdout
      });
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({
        checked: true,
        message: `Compatibility probe failed to start: ${error.message}`,
        status: "fail"
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const combined = `${stdout}\n${stderr}`;
      const missingTokens = EXPECTED_CODEX_TOKENS.filter(
        (token) => !combined.includes(token)
      );

      if (code !== 0) {
        finish({
          checked: true,
          message: `Compatibility probe exited with code ${code ?? 1}.`,
          status: "warning",
          stderr,
          stdout
        });
        return;
      }

      finish({
        checked: true,
        message:
          missingTokens.length === 0
            ? "Compatibility probe found the expected Codex command surface."
            : `Compatibility probe is missing expected Codex tokens: ${missingTokens.join(", ")}.`,
        status: missingTokens.length === 0 ? "pass" : "warning",
        stderr,
        stdout
      });
    });
  });

export const inspectConfiguredCodexCommand = async (
  config: Pick<ModelConfig, "clientCommand">,
  options: InspectCodexCommandOptions = {}
): Promise<CodexCommandInspection> => {
  const env = options.env ?? process.env;
  const resolution = resolveCodexCommandResolution(config);
  const resolvedPath = await resolveCommandOnPath(resolution.command, env);
  const isPathLike = looksLikeFileSystemPath(resolution.command);

  if (!resolvedPath) {
    return {
      command: resolution.command,
      configuredCommand: resolution.configuredCommand,
      isPathLike,
      resolvedPath: null,
      source: resolution.source,
      status: "fail",
      compatibility: {
        checked: false,
        message: `Codex command '${resolution.command}' was not found.`,
        status: "fail"
      }
    };
  }

  if (!options.checkCompatibility) {
    return {
      command: resolution.command,
      configuredCommand: resolution.configuredCommand,
      isPathLike,
      resolvedPath,
      source: resolution.source,
      status: "pass",
      compatibility: {
        checked: false,
        message: "Command resolution passed.",
        status: "pass"
      }
    };
  }

  const compatibility = await runCodexHelpProbe(
    resolvedPath,
    env,
    options.timeoutMs ?? 5_000
  );

  return {
    command: resolution.command,
    configuredCommand: resolution.configuredCommand,
    isPathLike,
    resolvedPath,
    source: resolution.source,
    status:
      compatibility.status === "fail"
        ? "fail"
        : compatibility.status === "warning"
          ? "warning"
          : "pass",
    compatibility
  };
};
