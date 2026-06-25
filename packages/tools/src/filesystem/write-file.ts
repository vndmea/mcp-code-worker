import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ExecutionContext } from "@agent-orchestrator/core";
import {
  AgentError,
  createExecutionContextFromEnv,
  writeAuditEvent
} from "@agent-orchestrator/core";

export interface WriteFileResult {
  mode: "execute" | "dry-run";
  path: string;
  normalizedPath: string;
  reason: string;
  written: boolean;
}

export const writeRepositoryFile = async (
  path: string,
  content: string,
  context: ExecutionContext = createExecutionContextFromEnv(),
  explicitAllowWrite = false
): Promise<WriteFileResult> => {
  const evaluation = context.writePolicy.evaluate(path, explicitAllowWrite);

  if (!evaluation.allowed || evaluation.mode === "blocked") {
    await writeAuditEvent(
      context,
      {
        actor: "tool",
        action: "write-file",
        mode: "blocked",
        tool: "writeRepositoryFile",
        inputSummary: `Attempted to write ${path}`,
        outputSummary: evaluation.reason,
        warnings: [],
        errors: [evaluation.reason],
        metadata: {
          path,
          normalizedPath: evaluation.normalizedPath,
          riskLevel: evaluation.riskLevel
        }
      },
      explicitAllowWrite
    );

    throw new AgentError("WRITE_BLOCKED", evaluation.reason, {
      normalizedPath: evaluation.normalizedPath,
      riskLevel: evaluation.riskLevel
    });
  }

  if (evaluation.mode === "dry-run") {
    await writeAuditEvent(
      context,
      {
        actor: "tool",
        action: "write-file",
        mode: "dry-run",
        tool: "writeRepositoryFile",
        inputSummary: `Would write ${path}`,
        outputSummary: evaluation.reason,
        warnings: [],
        errors: [],
        metadata: {
          path,
          normalizedPath: evaluation.normalizedPath
        }
      },
      explicitAllowWrite
    );

    return {
      mode: evaluation.mode,
      path,
      normalizedPath: evaluation.normalizedPath,
      reason: evaluation.reason,
      written: false
    };
  }

  await mkdir(dirname(evaluation.normalizedPath), { recursive: true });
  await writeFile(evaluation.normalizedPath, content, "utf8");
  await writeAuditEvent(
    context,
    {
      actor: "tool",
      action: "write-file",
      mode: "execute",
      tool: "writeRepositoryFile",
      inputSummary: `Wrote ${path}`,
      outputSummary: "File write completed.",
      warnings: [],
      errors: [],
      metadata: {
        path,
        normalizedPath: evaluation.normalizedPath
      }
    },
    explicitAllowWrite
  );

  return {
    mode: evaluation.mode,
    path,
    normalizedPath: evaluation.normalizedPath,
    reason: evaluation.reason,
    written: true
  };
};
