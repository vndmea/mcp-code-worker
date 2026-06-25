import type { ExecutionContext } from "@agent-orchestrator/core";
import {
  AgentError,
  createExecutionContextFromEnv,
  writeAuditEvent
} from "@agent-orchestrator/core";

import { runCommand, type RunCommandResult } from "./run-command.js";

export interface SafeCommandResult extends RunCommandResult {
  mode: "execute" | "dry-run";
}

export interface SafeCommandOptions {
  env?: Record<string, string>;
  maxOutputBytes?: number;
  timeoutMs?: number;
}

const splitCommand = (command: string) => {
  const parts = command.trim().split(/\s+/u).filter(Boolean);
  return {
    command: parts[0] ?? "",
    args: parts.slice(1)
  };
};

export const runSafeCommand = async (
  commandLine: string,
  context: ExecutionContext = createExecutionContextFromEnv(),
  options: SafeCommandOptions = {}
): Promise<SafeCommandResult> => {
  const evaluation = context.safetyPolicy.evaluateCommand(commandLine);

  if (!evaluation.allowed) {
    await writeAuditEvent(context, {
      actor: "tool",
      action: "run-command",
      mode: "blocked",
      tool: "runSafeCommand",
      inputSummary: commandLine,
      outputSummary: evaluation.reason,
      warnings: [],
      errors: [evaluation.reason],
      metadata: {
        command: commandLine
      }
    });

    throw new AgentError("COMMAND_BLOCKED", evaluation.reason, {
      command: commandLine
    });
  }

  if (evaluation.mode === "dry-run") {
    await writeAuditEvent(context, {
      actor: "tool",
      action: "run-command",
      mode: "dry-run",
      tool: "runSafeCommand",
      inputSummary: commandLine,
      outputSummary: evaluation.reason,
      warnings: [],
      errors: [],
      metadata: {
        command: commandLine
      }
    });

    return {
      code: 0,
      mode: "dry-run",
      stdout: "",
      stderr: ""
    };
  }

  const parsed = splitCommand(commandLine);
  const result = await runCommand(parsed.command, parsed.args, context.rootDir, {
    env: options.env,
    maxOutputBytes: options.maxOutputBytes,
    timeoutMs: options.timeoutMs
  });
  await writeAuditEvent(context, {
    actor: "tool",
    action: "run-command",
    mode: result.timedOut ? "blocked" : "execute",
    tool: "runSafeCommand",
    inputSummary: commandLine,
    outputSummary: result.timedOut
      ? "Command timed out."
      : `Command exited with code ${String(result.code)}.`,
    warnings: [],
    errors:
      result.code !== null && result.code !== 0 && result.stderr.length > 0
        ? [result.stderr]
        : [],
    metadata: {
      command: commandLine,
      code: result.code,
      stderrTruncated: result.stderrTruncated,
      stdoutTruncated: result.stdoutTruncated,
      timedOut: result.timedOut
    }
  });

  return {
    ...result,
    mode: "execute"
  };
};
