import type { Command } from "commander";

import {
  createExecutionContextFromEnv,
  writeAuditEvent
} from "@agent-orchestrator/core";
import {
  runFixErrorWorkflow,
  runLeaderWorkerWorkflow,
  runPlanningWorkflow,
  runReviewWorkflow,
  runWorkerInterviewWorkflow
} from "@agent-orchestrator/graph";

import type { CliIo } from "../index.js";

const workflowAliases: Record<string, string> = {
  "leader-worker-basic": "leader-worker-workflow"
};

export const registerRunCommand = (program: Command, io: CliIo): void => {
  program
    .command("run")
    .description("Run a built-in workflow by name.")
    .argument("<workflow>", "Workflow name")
    .option("--goal <goal>", "Goal for planning or leader-worker workflows")
    .option("--scope <scope>", "Optional repository or package scope")
    .option("--diff <diff>", "Diff text or revision range for review workflow")
    .option("--file <path...>", "Optional file list for review workflow")
    .option("--error-log <text>", "Error log text for fix-error workflow")
    .option("--worker <workerId>", "Worker profile id for leader-worker workflows")
    .option("--require-profile", "Fail if no usable worker profile is available", false)
    .option("--allow-write", "Allow writes for this invocation", false)
    .action(
      async (
        workflow: string,
        options: {
          allowWrite: boolean;
          diff?: string;
          errorLog?: string;
          file?: string[];
          goal?: string;
          requireProfile: boolean;
          scope?: string;
          worker?: string;
        }
      ) => {
        const resolvedWorkflow = workflowAliases[workflow] ?? workflow;
        const context = createExecutionContextFromEnv(undefined, {
          allowWrite: options.allowWrite,
          dryRun: !options.allowWrite
        });
        const supportsWorkerProfiles =
          resolvedWorkflow === "leader-worker-workflow";

        if (!supportsWorkerProfiles && options.worker) {
          throw new Error(`--worker is only supported for leader-worker-workflow.`);
        }

        if (!supportsWorkerProfiles && options.requireProfile) {
          throw new Error(
            `--require-profile is only supported for leader-worker-workflow.`
          );
        }

        let result: unknown;
        switch (resolvedWorkflow) {
          case "planning-workflow":
            result = await runPlanningWorkflow({
              context,
              goal: options.goal ?? "No goal provided"
            });
            break;
          case "leader-worker-workflow":
            result = await runLeaderWorkerWorkflow({
              context,
              goal: options.goal ?? "No goal provided",
              requireProfile: options.requireProfile,
              scope: options.scope,
              workerId: options.worker
            });
            break;
          case "review-workflow":
            result = await runReviewWorkflow({
              context,
              diff: options.diff,
              files: options.file
            });
            break;
          case "fix-error-workflow":
            result = await runFixErrorWorkflow({
              context,
              errorLog: options.errorLog ?? "",
              scope: options.scope
            });
            break;
          case "worker-interview-workflow":
            result = await runWorkerInterviewWorkflow({
              context,
              workerId: options.scope,
              modelConfig: context.workerModel
            });
            break;
          default:
            throw new Error(`Unknown workflow: ${workflow}`);
        }

        if (resolvedWorkflow === "leader-worker-workflow") {
          await writeAuditEvent(context, {
            actor: "cli",
            action: "run-workflow",
            mode: context.dryRun ? "dry-run" : "execute",
            workflow: resolvedWorkflow,
            inputSummary: `ao run ${resolvedWorkflow}`,
            outputSummary: "Leader-worker workflow CLI invocation completed.",
            warnings: [],
            errors: [],
            metadata: {
              requireProfile: options.requireProfile,
              scope: options.scope,
              workerId: options.worker
            }
          });
        }

        io.write(JSON.stringify(result, null, 2));
      }
    );
};
