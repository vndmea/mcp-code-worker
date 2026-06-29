import type { ExecutionContextOverrides } from "../runtime/execution-context.js";

export const createAllowWriteCliOverrides = (
  allowWrite: boolean | undefined,
  options: {
    dryRunWhenDisallowed?: boolean;
  } = {}
): ExecutionContextOverrides =>
  allowWrite === undefined
    ? {}
    : {
        allowWrite,
        dryRun: allowWrite ? false : (options.dryRunWhenDisallowed ?? true)
      };

export const createExecuteCliOverrides = (
  execute: boolean | undefined
): ExecutionContextOverrides => (execute ? { dryRun: false } : {});
