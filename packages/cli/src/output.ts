import type { WorkflowOutputOptions } from "@agent-orchestrator/graph";

import type { CliIo } from "./index.js";

export interface CliDetailOptions {
  artifactRefs?: boolean;
  full?: boolean;
  maxBytes?: number;
  summary?: boolean;
}

export const resolveWorkflowOutputOptions = (
  options: CliDetailOptions
): WorkflowOutputOptions => ({
  detailLevel: options.summary && !options.full ? "summary" : "full",
  includeArtifactRefs: options.artifactRefs ?? true,
  maxBytes: options.maxBytes
});

export const writeJson = (io: CliIo, value: unknown): void => {
  io.write(JSON.stringify(value, null, 2));
};
