import { z } from "zod";

import {
  AgentError,
  readTaskArtifact,
  readTaskSession,
  resolveExecutionContext,
  truncateText
} from "@agent-orchestrator/core";

import type { AoToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  taskId: z.string().min(1),
  artifactName: z.string().min(1),
  maxBytes: z.number().int().positive().max(200_000).optional()
});

export const aoReadTaskArtifactTool: AoToolDefinition<
  typeof inputSchema.shape,
  {
    artifactName: string;
    contentType: "json" | "text";
    exists: boolean;
    path: string;
    preview?: string;
    taskId: string;
    truncated: boolean;
    value?: unknown;
  }
> = {
  name: "ao_read_task_artifact",
  description:
    "Read one persisted task artifact from user-scoped ao storage using a session-scoped artifact name.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveExecutionContext();
    const rootDir = context.rootDir;
    const session = await readTaskSession(
      rootDir,
      args.taskId,
      context.aoStorageDir
    );

    if (!session) {
      throw new AgentError(
        "TASK_SESSION_NOT_FOUND",
        `Task session ${args.taskId} was not found.`,
        {
          taskId: args.taskId
        }
      );
    }

    if (!session.artifacts[args.artifactName]) {
      throw new AgentError(
        "TASK_ARTIFACT_NOT_FOUND",
        `Artifact ${args.artifactName} is not registered for task ${args.taskId}.`,
        {
          artifactName: args.artifactName,
          taskId: args.taskId
        }
      );
    }

    const artifact = await readTaskArtifact(
      rootDir,
      args.taskId,
      args.artifactName,
      context.aoStorageDir
    );
    const serialized =
      typeof artifact.value === "string"
        ? artifact.value
        : JSON.stringify(artifact.value, null, 2);
    const maxBytes = args.maxBytes;
    const shouldTruncate =
      typeof maxBytes === "number" &&
      artifact.value !== null &&
      Buffer.byteLength(serialized, "utf8") > maxBytes;

    return {
      taskId: args.taskId,
      artifactName: args.artifactName,
      exists: artifact.exists,
      path: artifact.path,
      contentType: typeof artifact.value === "string" ? "text" : "json",
      truncated: shouldTruncate,
      ...(shouldTruncate
        ? {
            preview: truncateText(serialized, maxBytes)
          }
        : {
            value: artifact.value ?? undefined
          })
    };
  }
};
