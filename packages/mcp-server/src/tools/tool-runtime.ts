import {
  createAllowWriteCliOverrides,
  createExecuteCliOverrides,
  resolveExecutionContext,
  writeAuditEvent,
  type ExecutionContext,
  type ExecutionContextOverrides
} from "@mcp-code-worker/core";
export {
  createAllowWriteCliOverrides,
  createExecuteCliOverrides
};

export const resolveToolContext = async (options: {
  cliOverrides?: ExecutionContextOverrides;
  rootDir?: string;
} = {}): Promise<ExecutionContext> =>
  resolveExecutionContext({
    rootDir: options.rootDir,
    cliOverrides: options.cliOverrides
  });

export const writeToolAuditEvent = async (input: {
  context: ExecutionContext;
  errors?: string[];
  inputSummary: string;
  metadata?: Record<string, unknown>;
  outputSummary: string;
  tool: string;
  warnings?: string[];
}): Promise<void> => {
  await writeAuditEvent(input.context, {
    actor: "mcp",
    action: "tool-call",
    mode: input.context.dryRun ? "dry-run" : "execute",
    tool: input.tool,
    inputSummary: input.inputSummary,
    outputSummary: input.outputSummary,
    warnings: input.warnings ?? [],
    errors: input.errors ?? [],
    ...(input.metadata ? { metadata: input.metadata } : {})
  });
};
