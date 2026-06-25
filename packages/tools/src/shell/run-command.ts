import { spawn } from "node:child_process";
import { extname } from "node:path";

export interface RunCommandResult {
  code: number | null;
  stderr: string;
  stdout: string;
  timedOut?: boolean;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
}

export interface RunCommandOptions {
  env?: Record<string, string>;
  maxOutputBytes?: number;
  stdin?: string;
  timeoutMs?: number;
}

const resolveCommandForSpawn = (command: string): string => {
  if (process.platform !== "win32") {
    return command;
  }

  if (command.includes("/") || command.includes("\\") || extname(command)) {
    return command;
  }

  return command === "pnpm" ? "pnpm.cmd" : command;
};

const resolveSpawnSpec = (
  command: string,
  args: string[]
): { command: string; args: string[] } => {
  const resolvedCommand = resolveCommandForSpawn(command);

  if (process.platform === "win32" && resolvedCommand.endsWith(".cmd")) {
    return {
      command: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", resolvedCommand, ...args]
    };
  }

  return {
    command: resolvedCommand,
    args
  };
};

const appendChunk = (
  existing: string,
  chunk: Buffer,
  maxOutputBytes: number
): { value: string; truncated: boolean } => {
  const nextValue = existing + chunk.toString();
  if (Buffer.byteLength(nextValue, "utf8") <= maxOutputBytes) {
    return {
      value: nextValue,
      truncated: false
    };
  }

  const buffer = Buffer.from(nextValue, "utf8");
  return {
    value: buffer.subarray(0, maxOutputBytes).toString("utf8"),
    truncated: true
  };
};

export const runCommand = async (
  command: string,
  args: string[],
  cwd = process.cwd(),
  options: RunCommandOptions = {}
): Promise<RunCommandResult> =>
  new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const maxOutputBytes = options.maxOutputBytes ?? 200_000;
    const spawnSpec = resolveSpawnSpec(command, args);
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      cwd,
      env: options.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const next = appendChunk(stdout, chunk, maxOutputBytes);
      stdout = next.value;
      stdoutTruncated = stdoutTruncated || next.truncated;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const next = appendChunk(stderr, chunk, maxOutputBytes);
      stderr = next.value;
      stderrTruncated = stderrTruncated || next.truncated;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    if (options.stdin !== undefined) {
      child.stdin.write(options.stdin, "utf8");
    }
    child.stdin.end();
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        code,
        stdout,
        stderr,
        timedOut,
        stdoutTruncated,
        stderrTruncated
      });
    });
  });
