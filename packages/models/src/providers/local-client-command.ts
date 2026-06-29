import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { delimiter, extname, join } from "node:path";

import {
  looksLikeFileSystemPath,
  normalizeCommandInput,
  type ModelConfig
} from "@mcp-code-worker/core";

export interface InspectLocalClientCommandOptions {
  checkCompatibility?: boolean;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export type LocalClientCommandSource = "configured" | "default";

export interface LocalClientCommandResolution {
  command: string;
  configuredCommand: string | null;
  source: LocalClientCommandSource;
}

export interface LocalClientCompatibilityResult {
  checked: boolean;
  message: string;
  status: "pass" | "warning" | "fail";
  stderr?: string;
  stdout?: string;
}

export interface LocalClientCommandInspection {
  command: string;
  compatibility: LocalClientCompatibilityResult;
  configuredCommand: string | null;
  isPathLike: boolean;
  resolvedPath: string | null;
  source: LocalClientCommandSource;
  status: "pass" | "warning" | "fail";
}

const WINDOWS_EXECUTABLE_EXTENSIONS = new Set([
  ".com",
  ".exe",
  ".bat",
  ".cmd"
]);

const EXPECTED_LOCAL_CLIENT_FLAGS = [
  "--model",
  "--output-format",
  "--permission-mode"
];

const hasWindowsDrivePrefix = (value: string): boolean =>
  /^[a-z]:/iu.test(value);

const hasPathSeparator = (value: string): boolean =>
  value.includes("/") || value.includes("\\");

const buildCommandCandidates = (
  command: string,
  env: NodeJS.ProcessEnv
): string[] => {
  const isWindows = process.platform === "win32";
  const pathExt = isWindows
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .map((ext) => ext.trim())
        .filter((ext) => ext.length > 0)
    : [];
  const hasExplicitExtension = /\.[^./\\]+$/u.test(command);
  const suffixes = hasExplicitExtension || !isWindows ? [""] : ["", ...pathExt];
  const bases =
    hasPathSeparator(command) || hasWindowsDrivePrefix(command)
      ? [command]
      : (env.PATH ?? "")
          .split(delimiter)
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
          .map((entry) => join(entry, command));

  const candidates: string[] = [];

  for (const base of bases) {
    for (const suffix of suffixes) {
      candidates.push(`${base}${suffix}`);
    }
  }

  return Array.from(new Set(candidates));
};

export const resolveLocalClientCommandResolution = (
  config: Pick<ModelConfig, "clientCommand">
): LocalClientCommandResolution => {
  const configuredCommand = config.clientCommand?.trim();

  return {
    command: normalizeCommandInput(configuredCommand || "opencode"),
    configuredCommand: configuredCommand
      ? normalizeCommandInput(configuredCommand)
      : null,
    source: configuredCommand ? "configured" : "default"
  };
};

export const resolveLocalClientCommand = (
  config: Pick<ModelConfig, "clientCommand">
): string => resolveLocalClientCommandResolution(config).command;

export const resolveCommandOnPath = async (
  command: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<string | null> => {
  const accessMode = process.platform === "win32"
    ? constants.F_OK
    : constants.X_OK;

  for (const candidate of buildCommandCandidates(command, env)) {
    try {
      await access(candidate, accessMode);
      return candidate;
    } catch {
      // Keep scanning candidates.
    }
  }

  return null;
};

const runHelpProbe = async (
  resolvedCommand: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<LocalClientCompatibilityResult> =>
  await new Promise((resolve) => {
    const child = spawn(resolvedCommand, ["--help"], {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: LocalClientCompatibilityResult): void => {
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
      const missingFlags = EXPECTED_LOCAL_CLIENT_FLAGS.filter(
        (flag) => !combined.includes(flag)
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
          missingFlags.length === 0
            ? "Compatibility probe found the expected local client flags."
            : `Compatibility probe is missing expected flags: ${missingFlags.join(", ")}.`,
        status: missingFlags.length === 0 ? "pass" : "warning",
        stderr,
        stdout
      });
    });
  });

export const inspectLocalClientCommand = async (
  command: string,
  options: InspectLocalClientCommandOptions = {}
): Promise<LocalClientCommandInspection> => {
  const env = options.env ?? process.env;
  const normalizedCommand = normalizeCommandInput(command);
  const resolvedPath = await resolveCommandOnPath(normalizedCommand, env);
  const isPathLike = looksLikeFileSystemPath(command);
  const extension = extname(normalizedCommand).toLowerCase();

  if (!resolvedPath) {
    return {
      command: normalizedCommand,
      configuredCommand: normalizedCommand,
      isPathLike,
      resolvedPath: null,
      source: "configured",
      status: "fail",
      compatibility: {
        checked: false,
        message: `Local client command '${normalizedCommand}' was not found.`,
        status: "fail"
      }
    };
  }

  if (
    process.platform === "win32" &&
    extension.length > 0 &&
    !WINDOWS_EXECUTABLE_EXTENSIONS.has(extension)
  ) {
    return {
      command: normalizedCommand,
      configuredCommand: normalizedCommand,
      isPathLike,
      resolvedPath,
      source: "configured",
      status: "warning",
      compatibility: {
        checked: false,
        message:
          `Resolved local client path ends with '${extension}', which is not a typical executable extension on Windows.`,
        status: "warning"
      }
    };
  }

  if (!options.checkCompatibility) {
    return {
      command: normalizedCommand,
      configuredCommand: normalizedCommand,
      isPathLike,
      resolvedPath,
      source: "configured",
      status: "pass",
      compatibility: {
        checked: false,
        message: "Command resolution passed.",
        status: "pass"
      }
    };
  }

  const compatibility = await runHelpProbe(
    resolvedPath,
    env,
    options.timeoutMs ?? 5_000
  );

  return {
    command: normalizedCommand,
    configuredCommand: normalizedCommand,
    isPathLike,
    resolvedPath,
    source: "configured",
    status:
      compatibility.status === "fail"
        ? "fail"
        : compatibility.status === "warning"
          ? "warning"
          : "pass",
    compatibility
  };
};

export const inspectConfiguredLocalClientCommand = async (
  config: Pick<ModelConfig, "clientCommand">,
  options: InspectLocalClientCommandOptions = {}
): Promise<LocalClientCommandInspection> => {
  const resolution = resolveLocalClientCommandResolution(config);
  const inspection = await inspectLocalClientCommand(resolution.command, options);

  return {
    ...inspection,
    configuredCommand: resolution.configuredCommand,
    source: resolution.source
  };
};
