import {
  createAllowWriteCliOverrides,
  createExecuteCliOverrides,
  resolveExecutionContext,
  type ExecutionContext,
  type ExecutionContextOverrides
} from "@mcp-code-worker/core";

type CommandWriteMode = "inherit" | "require-flag";

export const resolveCommandContext = async (options: {
  allowWrite?: boolean;
  dryRunWhenDisallowed?: boolean;
  execute?: boolean;
  forceExecute?: boolean;
  rootDir?: string;
  writeMode?: CommandWriteMode;
} = {}): Promise<ExecutionContext> => {
  const cliOverrides: ExecutionContextOverrides = {
    ...(
      options.writeMode === "require-flag"
        ? createAllowWriteCliOverrides(options.allowWrite ?? false, {
            dryRunWhenDisallowed: options.dryRunWhenDisallowed
          })
        : options.allowWrite
          ? createAllowWriteCliOverrides(true, {
              dryRunWhenDisallowed: options.dryRunWhenDisallowed
            })
          : {}
    ),
    ...(options.forceExecute ? { dryRun: false } : createExecuteCliOverrides(options.execute))
  };

  return resolveExecutionContext({
    rootDir: options.rootDir,
    cliOverrides
  });
};
