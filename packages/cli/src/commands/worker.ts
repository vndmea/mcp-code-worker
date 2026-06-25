import type { Command } from "commander";

import { createExecutionContextFromEnv } from "@agent-orchestrator/core";
import { runWorkerInterviewWorkflow } from "@agent-orchestrator/graph";
import {
  deriveWorkerRegistrationId,
  getWorkerRegistration,
  ModelRouter,
  getWorkerProfile,
  listWorkerRegistrations,
  listWorkerProfiles,
  removeWorkerRegistration,
  resolveWorkerModel,
  saveWorkerRegistration,
  saveWorkerProfile
} from "@agent-orchestrator/models";

import type { CliIo } from "../index.js";

export const registerWorkerCommand = (program: Command, io: CliIo): void => {
  const worker = program.command("worker").description("Manage worker onboarding and profiles.");

  worker
    .command("register")
    .description("Register a worker model in the local worker registry.")
    .option("--worker <workerId>", "Worker registry id")
    .requiredOption("--provider <provider>", "Worker provider")
    .requiredOption("--model <model>", "Worker model")
    .option("--base-url <url>", "Worker base URL")
    .option("--api-key-env-var <name>", "Environment variable containing the API key")
    .option("--tag <tag>", "Worker tag", (value, previous: string[]) => [
      ...previous,
      value
    ], [])
    .option("--notes <notes>", "Optional registry notes")
    .option("--allow-write", "Persist the registration", false)
    .action(
      async (options: {
        allowWrite: boolean;
        apiKeyEnvVar?: string;
        baseUrl?: string;
        model: string;
        notes?: string;
        provider: string;
        tag: string[];
        worker?: string;
      }) => {
        const context = createExecutionContextFromEnv(undefined, {
          allowWrite: options.allowWrite,
          dryRun: !options.allowWrite
        });
        const workerId =
          options.worker ??
          deriveWorkerRegistrationId({
            provider: options.provider,
            model: options.model
          });
        const existing = await getWorkerRegistration(context.rootDir, workerId);
        const now = new Date().toISOString();
        const result = await saveWorkerRegistration(
          context,
          {
            workerId,
            provider: options.provider,
            model: options.model,
            baseURL: options.baseUrl,
            apiKeyEnvVar: options.apiKeyEnvVar,
            enabled: existing?.enabled ?? true,
            tags: options.tag,
            notes: options.notes,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now
          },
          options.allowWrite
        );

        io.write(
          JSON.stringify(
            {
              ...result,
              workerId
            },
            null,
            2
          )
        );
      }
    );

  worker
    .command("unregister")
    .description("Remove a worker from the local worker registry.")
    .argument("<workerId>", "Worker registry id")
    .option("--allow-write", "Persist the removal", false)
    .action(async (workerId: string, options: { allowWrite: boolean }) => {
      const context = createExecutionContextFromEnv(undefined, {
        allowWrite: options.allowWrite,
        dryRun: !options.allowWrite
      });
      const result = await removeWorkerRegistration(
        context,
        workerId,
        options.allowWrite
      );

      io.write(JSON.stringify(result, null, 2));
    });

  const registry = worker
    .command("registry")
    .description("Inspect the local worker registry.");

  registry
    .command("list")
    .description("List registered worker models.")
    .action(async () => {
      const context = createExecutionContextFromEnv();
      io.write(
        JSON.stringify(await listWorkerRegistrations(context.rootDir), null, 2)
      );
    });

  registry
    .command("get")
    .description("Get one registered worker model.")
    .argument("<workerId>", "Worker registry id")
    .action(async (workerId: string) => {
      const context = createExecutionContextFromEnv();
      const registration = await getWorkerRegistration(context.rootDir, workerId);

      if (!registration) {
        throw new Error(`No worker registration found for ${workerId}`);
      }

      io.write(JSON.stringify(registration, null, 2));
    });

  worker
    .command("interview")
    .description("Evaluate a worker model before assigning production tasks.")
    .option("--worker <workerId>", "Optional worker profile id")
    .option("--provider <provider>", "Override worker provider")
    .option("--model <model>", "Override worker model")
    .option("--base-url <url>", "Override worker base URL")
    .option("--save", "Persist the resulting worker profile", false)
    .action(
      async (options: {
        baseUrl?: string;
        model?: string;
        provider?: string;
        save: boolean;
        worker?: string;
      }) => {
        const context = createExecutionContextFromEnv();
        const hasModelOverride =
          Boolean(options.provider) || Boolean(options.model) || Boolean(options.baseUrl);
        const registeredWorker = options.worker
          ? await getWorkerRegistration(context.rootDir, options.worker)
          : null;
        const resolved = registeredWorker
          ? await resolveWorkerModel({
              context,
              workerId: options.worker
            })
          : null;

        if (options.worker && !registeredWorker && !hasModelOverride) {
          throw new Error(`Worker ${options.worker} is not registered.`);
        }

        const modelConfig = resolved?.modelConfig ?? {
          ...context.workerModel,
          ...(options.provider ? { provider: options.provider } : {}),
          ...(options.model ? { model: options.model } : {}),
          ...(options.baseUrl ? { baseURL: options.baseUrl } : {})
        };
        const result = await runWorkerInterviewWorkflow({
          context,
          workerId: resolved?.workerId ?? options.worker,
          modelConfig
        });

        const saveResult = options.save
          ? await saveWorkerProfile(context, result.profile, true)
          : null;

        io.write(
          JSON.stringify(
            {
              ...result,
              persistence: saveResult
            },
            null,
            2
          )
        );
      }
    );

  worker
    .command("list")
    .description("List known worker capability profiles.")
    .action(async () => {
      const context = createExecutionContextFromEnv();
      io.write(JSON.stringify(await listWorkerProfiles(context.rootDir), null, 2));
    });

  worker
    .command("profile")
    .description("Get a worker capability profile by id.")
    .argument("[workerId]", "Worker profile id")
    .action(async (workerId?: string) => {
      const context = createExecutionContextFromEnv();
      const resolvedWorkerId =
        workerId ?? ModelRouter.deriveWorkerId(context.workerModel);
      const profile = await getWorkerProfile(context.rootDir, resolvedWorkerId);

      if (!profile) {
        throw new Error(`No worker profile found for ${resolvedWorkerId}`);
      }

      io.write(JSON.stringify(profile, null, 2));
    });
};
