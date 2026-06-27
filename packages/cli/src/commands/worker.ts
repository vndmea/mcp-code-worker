import type { Command } from "commander";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import {
  applyBenchmarkCapabilityUpdate,
  runWorkerBenchmarkWorkflow,
  runWorkerInterviewWorkflow,
  saveWorkerBenchmarkArtifact
} from "@agent-orchestrator/graph";
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
import { writeOutput } from "../output.js";

const formatWorkerList = (
  title: string,
  entries: Array<{ model?: string; provider?: string; status?: string; workerId?: string }>
): string[] => {
  const lines: string[] = [title];

  if (entries.length > 0) {
    for (const entry of entries) {
      lines.push(
        `${entry.workerId ?? `${entry.provider}:${entry.model}`} (${entry.status ?? "configured"})`
      );
    }
  } else {
    lines.push("none");
  }

  return lines;
};

const formatWorkerRegisterResult = (result: {
  mode: "execute" | "dry-run";
  path: string;
  workerId: string;
}): string[] => [
  result.mode === "execute"
    ? `Registered worker ${result.workerId}.`
    : `Dry-run: would register worker ${result.workerId}.`,
  `registry: ${result.path}`
];

const formatWorkerUnregisterResult = (result: {
  mode: "execute" | "dry-run";
  path: string;
  removed: boolean;
}): string[] => [
  result.mode === "execute"
    ? result.removed
      ? "Worker unregistered."
      : "Worker was already absent."
    : "Dry-run: worker would be unregistered.",
  `registry: ${result.path}`
];

const formatWorkerInterviewResult = (result: {
  persistence?: { mode?: string; path?: string; reason?: string } | null;
  profile: {
    admission?: { blockingReasons: string[]; passed: boolean };
    portrait?: {
      answerDirectness: number;
      repoGrounding: number;
      scopeDiscipline: number;
    };
    status: string;
    supportedTaskTypes: string[];
    taskScores?: {
      codegen: number;
      logAnalysis: number;
      reviewLite: number;
    };
    workerId: string;
  };
  warnings: string[];
}): string[] => {
  const formatScore = (value: number): string => value.toFixed(2);
  const lines: string[] = [
    `worker interview: ${result.profile.workerId}`,
    `status: ${result.profile.status}`
  ];

  if (result.profile.admission) {
    lines.push(
      result.profile.admission.passed
        ? "admission: passed"
        : `admission: blocked (${result.profile.admission.blockingReasons.join("; ")})`
    );
  }

  if (result.profile.supportedTaskTypes.length > 0) {
    lines.push(`supports: ${result.profile.supportedTaskTypes.join(", ")}`);
  }

  if (result.profile.portrait) {
    lines.push(
      `portrait: repoGrounding=${formatScore(result.profile.portrait.repoGrounding)}, scope=${formatScore(result.profile.portrait.scopeDiscipline)}, directness=${formatScore(result.profile.portrait.answerDirectness)}`
    );
  }

  if (result.profile.taskScores) {
    lines.push(
      `task scores: review-lite=${formatScore(result.profile.taskScores.reviewLite)}, log-analysis=${formatScore(result.profile.taskScores.logAnalysis)}, codegen=${formatScore(result.profile.taskScores.codegen)}`
    );
  }

  if (result.persistence) {
    if (result.persistence.mode === "execute") {
      lines.push(`profile saved: ${result.persistence.path ?? "persisted"}`);
    } else if (result.persistence.mode === "dry-run") {
      lines.push(
        `dry-run: profile would be saved to ${result.persistence.path ?? "the ao workspace profile store"}`
      );
    } else {
      lines.push(result.persistence.reason ?? "profile was not persisted");
    }
  }

  if (result.warnings.length > 0) {
    lines.push(`warnings: ${result.warnings.join(" | ")}`);
  }

  return lines;
};

const formatWorkerBenchmarkResult = (result: {
  capabilityUpdateApplied?: boolean;
  patchGenerationQualified?: boolean;
  persistence?: { mode?: string; path?: string } | null;
  profilePersistence?: { mode?: string; path?: string } | null;
  suiteName?: string;
  warnings?: string[];
  workerId: string;
}): string[] => {
  const lines: string[] = [
    `worker benchmark: ${result.workerId}`,
    `patch generation qualified: ${result.patchGenerationQualified ? "yes" : "no"}`,
    `capability update applied: ${result.capabilityUpdateApplied ? "yes" : "no"}`
  ];

  if (result.suiteName) {
    lines.push(`suite: ${result.suiteName}`);
  }

  if (result.persistence) {
    lines.push(
      `artifact persistence: ${result.persistence.mode}${result.persistence.path ? ` (${result.persistence.path})` : ""}`
    );
  }

  if (result.profilePersistence) {
    lines.push(
      `profile persistence: ${result.profilePersistence.mode}${result.profilePersistence.path ? ` (${result.profilePersistence.path})` : ""}`
    );
  }

  if (result.warnings && result.warnings.length > 0) {
    lines.push(`warnings: ${result.warnings.join(" | ")}`);
  }

  return lines;
};

export const registerWorkerCommand = (program: Command, io: CliIo): void => {
  const worker = program.command("worker").description("Manage worker onboarding and profiles.");

  worker
    .command("register")
    .description("Register a worker model in the local worker registry.")
    .option("--worker <workerId>", "Worker registry id")
    .requiredOption("--provider <provider>", "Worker provider")
    .requiredOption("--model <model>", "Worker model")
    .option("--base-url <url>", "Worker base URL")
    .option("--tag <tag>", "Worker tag", (value, previous: string[]) => [
      ...previous,
      value
    ], [])
    .option("--notes <notes>", "Optional registry notes")
    .option("--allow-write", "Persist the registration", false)
    .action(
      async (options: {
        allowWrite: boolean;
        baseUrl?: string;
        model: string;
        notes?: string;
        provider: string;
        tag: string[];
        worker?: string;
      }) => {
        const context = await resolveExecutionContext({
          cliOverrides: {
            allowWrite: options.allowWrite,
            dryRun: !options.allowWrite
          }
        });
        const workerId =
          options.worker ??
          deriveWorkerRegistrationId({
            provider: options.provider,
            model: options.model
          });
        const existing = await getWorkerRegistration(
          context.rootDir,
          workerId,
          context.aoStorageDir
        );
        const now = new Date().toISOString();
        const result = await saveWorkerRegistration(
          context,
          {
            workerId,
            provider: options.provider,
            model: options.model,
            baseURL: options.baseUrl,
            enabled: existing?.enabled ?? true,
            tags: options.tag,
            notes: options.notes,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now
          },
          options.allowWrite
        );

        writeOutput(
          io,
          {
            ...result,
            workerId
          },
          formatWorkerRegisterResult({
            ...result,
            workerId
          })
        );
      }
    );

  worker
    .command("unregister")
    .description("Remove a worker from the local worker registry.")
    .argument("<workerId>", "Worker registry id")
    .option("--allow-write", "Persist the removal", false)
    .action(async (workerId: string, options: { allowWrite: boolean }) => {
      const context = await resolveExecutionContext({
        cliOverrides: {
          allowWrite: options.allowWrite,
          dryRun: !options.allowWrite
        }
      });
      const result = await removeWorkerRegistration(
        context,
        workerId,
        options.allowWrite
      );

      writeOutput(io, result, formatWorkerUnregisterResult(result));
    });

  const registry = worker
    .command("registry")
    .description("Inspect the local worker registry.");

  registry
    .command("list")
    .description("List registered worker models.")
    .action(async () => {
      const context = await resolveExecutionContext();
      const registrations = await listWorkerRegistrations(
        context.rootDir,
        context.aoStorageDir
      );
      writeOutput(io, registrations, formatWorkerList("worker registry", registrations));
    });

  registry
    .command("get")
    .description("Get one registered worker model.")
    .argument("<workerId>", "Worker registry id")
    .action(async (workerId: string) => {
      const context = await resolveExecutionContext();
      const registration = await getWorkerRegistration(
        context.rootDir,
        workerId,
        context.aoStorageDir
      );

      if (!registration) {
        throw new Error(`No worker registration found for ${workerId}`);
      }

      writeOutput(io, registration, formatWorkerList("worker registration", [registration]));
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
        const context = await resolveExecutionContext();
        const hasModelOverride =
          Boolean(options.provider) || Boolean(options.model) || Boolean(options.baseUrl);
        const registeredWorker = options.worker
          ? await getWorkerRegistration(
              context.rootDir,
              options.worker,
              context.aoStorageDir
            )
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
          ? result.persistenceAdvice.canPersist
            ? await saveWorkerProfile(context, result.profile, true)
            : {
                mode: "skipped" as const,
                reason: result.persistenceAdvice.reason,
                recommendedActions: result.persistenceAdvice.recommendedActions
              }
          : null;

        writeOutput(
          io,
          {
            ...result,
            persistence: saveResult
          },
          formatWorkerInterviewResult({
            ...result,
            persistence: saveResult
          })
        );
      }
    );

  worker
    .command("benchmark")
    .description("Run a coding benchmark suite for a worker model and optionally persist the artifact.")
    .requiredOption("--suite <suite>", "Benchmark suite name")
    .option("--worker <workerId>", "Optional worker profile id")
    .option("--provider <provider>", "Override worker provider")
    .option("--model <model>", "Override worker model")
    .option("--base-url <url>", "Override worker base URL")
    .option("--save", "Persist the resulting benchmark artifact", false)
    .option(
      "--update-profile-capabilities",
      "Update persisted worker capabilities from benchmark results",
      false
    )
    .action(
      async (options: {
        baseUrl?: string;
        model?: string;
        provider?: string;
        save: boolean;
        suite: string;
        updateProfileCapabilities: boolean;
        worker?: string;
      }) => {
        if (options.suite !== "coding-v1") {
          throw new Error(`Unsupported benchmark suite: ${options.suite}`);
        }
        if (options.updateProfileCapabilities && !options.save) {
          throw new Error("--update-profile-capabilities requires --save.");
        }

        const context = await resolveExecutionContext();
        const hasModelOverride =
          Boolean(options.provider) || Boolean(options.model) || Boolean(options.baseUrl);
        const registeredWorker = options.worker
          ? await getWorkerRegistration(
              context.rootDir,
              options.worker,
              context.aoStorageDir
            )
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
        const result = await runWorkerBenchmarkWorkflow({
          context,
          suite: "coding-v1",
          workerId: resolved?.workerId ?? options.worker,
          modelConfig
        });
        const persistence = options.save
          ? await saveWorkerBenchmarkArtifact(context, result, true)
          : null;
        const existingProfile = await getWorkerProfile(
          context.rootDir,
          result.workerId,
          context.aoStorageDir
        );
        if (options.updateProfileCapabilities && !existingProfile) {
          throw new Error(
            `No persisted worker profile found for ${result.workerId}; run 'ao worker interview --save' first.`
          );
        }
        const profileUpdate = existingProfile
          ? applyBenchmarkCapabilityUpdate(existingProfile, result, {
              updateProfileCapabilities: options.updateProfileCapabilities
            })
          : null;
        const profilePersistence =
          options.save && profileUpdate
            ? await saveWorkerProfile(
                context,
                profileUpdate.profile,
                true
              )
            : null;

        writeOutput(
          io,
          {
            ...result,
            capabilityUpdateApplied: profileUpdate?.capabilityUpdateApplied ?? false,
            patchGenerationQualified:
              profileUpdate?.patchGenerationQualified ?? false,
            persistence,
            profilePersistence
          },
          formatWorkerBenchmarkResult({
            ...result,
            capabilityUpdateApplied: profileUpdate?.capabilityUpdateApplied ?? false,
            patchGenerationQualified:
              profileUpdate?.patchGenerationQualified ?? false,
            persistence,
            profilePersistence
          })
        );
      }
    );

  worker
    .command("list")
    .description("List known worker capability profiles.")
    .action(async () => {
      const context = await resolveExecutionContext();
      const profiles = await listWorkerProfiles(
        context.rootDir,
        context.aoStorageDir
      );
      writeOutput(io, profiles, formatWorkerList("worker profiles", profiles));
    });

  worker
    .command("profile")
    .description("Get a worker capability profile by id.")
    .argument("[workerId]", "Worker profile id")
    .action(async (workerId?: string) => {
      const context = await resolveExecutionContext();
      const resolvedWorkerId =
        workerId ?? ModelRouter.deriveWorkerId(context.workerModel);
      const profile = await getWorkerProfile(
        context.rootDir,
        resolvedWorkerId,
        context.aoStorageDir
      );

      if (!profile) {
        throw new Error(`No worker profile found for ${resolvedWorkerId}`);
      }

      writeOutput(io, profile, formatWorkerList("worker profile", [profile]));
    });
};
