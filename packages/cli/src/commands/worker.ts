import type { Command } from "commander";

import {
  resolveExecutionContext,
  type WorkerCapabilityProfile
} from "@mcp-code-worker/core";
import {
  runWorkerBenchmarkOnboarding,
  runWorkerInterviewOnboarding
} from "@mcp-code-worker/graph";
import {
  getWorkerRegistration,
  getWorkerProfile,
  listWorkerRegistrations,
  listWorkerProfiles,
  removeWorkerRegistration,
  requireConfiguredWorkerId,
  saveWorkerRegistration
} from "@mcp-code-worker/models";

import type { CliIo } from "../index.js";
import { writeOutput } from "../output.js";
import { resolveCommandContext } from "./command-runtime.js";
import {
  buildWorkerReadinessReport,
  formatWorkerReadinessResult
} from "./worker-readiness.js";

const formatWorkerList = (
  title: string,
  entries: Array<{ model?: string; provider?: string; status?: string; workerId?: string }>
): string[] => {
  const lines: string[] = [title];

  if (entries.length > 0) {
    for (const entry of entries) {
      lines.push(
        `${entry.workerId ?? "unnamed-worker"} (${entry.status ?? "configured"})`
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
  localClientRuntime?: {
    configuredCommand: string | null;
    resolvedCommand: string;
    source: string;
  };
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
        : `admission: denied (${result.profile.admission.blockingReasons.join("; ")})`
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

  if (result.localClientRuntime) {
    lines.push(
      `local client: configured=${result.localClientRuntime.configuredCommand ?? "(default)"} | resolved=${result.localClientRuntime.resolvedCommand} | source=${result.localClientRuntime.source}`
    );
  }

  if (result.persistence) {
    if (result.persistence.mode === "execute") {
      lines.push(`profile saved: ${result.persistence.path ?? "persisted"}`);
    } else if (result.persistence.mode === "dry-run") {
      lines.push(
        `dry-run: profile would be saved to ${result.persistence.path ?? "the cw workspace profile store"}`
      );
    } else {
      lines.push(result.persistence.reason ?? "profile was not persisted");
    }
  }

  if (result.persistence?.mode === "execute") {
    lines.push(`next: cw worker readiness --worker ${result.profile.workerId}`);
  }

  if (result.warnings.length > 0) {
    lines.push(`warnings: ${result.warnings.join(" | ")}`);
  }

  return lines;
};

const formatWorkerBenchmarkResult = (result: {
  capabilityUpdateApplied?: boolean;
  localClientRuntime?: {
    configuredCommand: string | null;
    resolvedCommand: string;
    source: string;
  };
  patchGenerationQualified?: boolean;
  persistence?: { mode?: string; path?: string } | null;
  profilePersistence?: { mode?: string; path?: string } | null;
  suiteName?: string;
  warnings?: string[];
  workerId: string;
}): string[] => {
  const lines: string[] = [
    `worker benchmark: ${result.workerId}`,
    `patch generation capability: ${result.patchGenerationQualified ? "qualified" : "not-qualified"}`,
    `capability update applied: ${result.capabilityUpdateApplied ? "yes" : "no"}`
  ];

  if (result.suiteName) {
    lines.push(`suite: ${result.suiteName}`);
  }

  if (result.localClientRuntime) {
    lines.push(
      `local client: configured=${result.localClientRuntime.configuredCommand ?? "(default)"} | resolved=${result.localClientRuntime.resolvedCommand} | source=${result.localClientRuntime.source}`
    );
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

  lines.push(`next: cw worker readiness --worker ${result.workerId}`);

  if (result.warnings && result.warnings.length > 0) {
    lines.push(`warnings: ${result.warnings.join(" | ")}`);
  }

  return lines;
};

const buildWorkerProfileRecommendation = (
  profile: Pick<
    WorkerCapabilityProfile,
    "routingPolicy" | "status" | "supportedTaskTypes"
  >
): {
  blockedUses: string[];
  recommendedSummary: string;
  recommendedUses: string[];
} => {
  const recommendedUses: string[] = [];
  const blockedUses: string[] = [];

  if (
    profile.supportedTaskTypes.includes("review-lite") ||
    profile.supportedTaskTypes.includes("code-understanding")
  ) {
    recommendedUses.push("review and code understanding");
  }

  if (
    profile.supportedTaskTypes.includes("summarization") ||
    profile.supportedTaskTypes.includes("log-analysis")
  ) {
    recommendedUses.push("summarization and log analysis");
  }

  if (
    profile.status === "qualified" &&
    profile.routingPolicy.allowCodegen
  ) {
    recommendedUses.push("implementation planning and code generation");
  }

  if (
    profile.status === "qualified" &&
    profile.routingPolicy.allowPatchGeneration
  ) {
    recommendedUses.push("full workflow tasks including patch generation");
  } else {
    blockedUses.push("patch generation");
  }

  if (!profile.routingPolicy.allowCodegen) {
    blockedUses.push("code generation");
  }

  const summaryParts: string[] = [];

  if (recommendedUses.length > 0) {
    summaryParts.push(`Recommended for ${recommendedUses.join(", ")}.`);
  }

  if (blockedUses.length > 0) {
    summaryParts.push(`Not recommended for ${blockedUses.join(", ")}.`);
  }

  if (summaryParts.length === 0) {
    summaryParts.push("No strong recommendation is available yet.");
  }

  return {
    recommendedUses,
    blockedUses,
    recommendedSummary: summaryParts.join(" ")
  };
};

const formatWorkerProfileResult = (
  profile: WorkerCapabilityProfile
): string[] => {
  const recommendation = buildWorkerProfileRecommendation(profile);
  const lines = [
    `worker profile: ${profile.workerId}`,
    `status: ${profile.status}`,
    `recommended: ${recommendation.recommendedSummary}`
  ];

  if (profile.supportedTaskTypes.length > 0) {
    lines.push(`supports: ${profile.supportedTaskTypes.join(", ")}`);
  }

  return lines;
};

const serializeWorkerProfileResult = (
  profile: WorkerCapabilityProfile
): WorkerCapabilityProfile & {
  blockedUses: string[];
  recommendedSummary: string;
  recommendedUses: string[];
} => ({
  ...profile,
  ...buildWorkerProfileRecommendation(profile)
});

export const registerWorkerCommand = (program: Command, io: CliIo): void => {
  const worker = program.command("worker").description("Manage worker onboarding and profiles.");

  worker
    .command("register")
    .description("Register a worker model in the local worker registry.")
    .requiredOption("--worker <workerId>", "User-defined worker id")
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
        worker: string;
      }) => {
        const context = await resolveCommandContext({
          allowWrite: options.allowWrite,
          writeMode: "require-flag"
        });
        const workerId = options.worker;
        const existing = await getWorkerRegistration(
          context.rootDir,
          workerId,
          context.cwStorageDir
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
      const context = await resolveCommandContext({
        allowWrite: options.allowWrite,
        writeMode: "require-flag"
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
        context.cwStorageDir
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
        context.cwStorageDir
      );

      if (!registration) {
        throw new Error(`No worker registration found for ${workerId}`);
      }

      writeOutput(io, registration, formatWorkerList("worker registration", [registration]));
    });

  worker
    .command("interview")
    .description("Evaluate a worker model before assigning production tasks.")
    .requiredOption("--worker <workerId>", "Worker profile id")
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
        worker: string;
      }) => {
        const context = await resolveExecutionContext();
        const result = await runWorkerInterviewOnboarding({
          baseURL: options.baseUrl,
          context,
          model: options.model,
          persistProfile: options.save,
          provider: options.provider,
          workerId: options.worker
        });

        writeOutput(
          io,
          result,
          formatWorkerInterviewResult(result)
        );
      }
    );

  worker
    .command("benchmark")
    .description("Run a coding benchmark suite for a worker model and optionally persist the artifact.")
    .requiredOption("--suite <suite>", "Benchmark suite name")
    .requiredOption("--worker <workerId>", "Worker profile id")
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
        worker: string;
      }) => {
        if (options.suite !== "coding-v1") {
          throw new Error(`Unsupported benchmark suite: ${options.suite}`);
        }
        if (options.updateProfileCapabilities && !options.save) {
          throw new Error("--update-profile-capabilities requires --save.");
        }

        const context = await resolveExecutionContext();
        const benchmarkUpdate = await runWorkerBenchmarkOnboarding({
          baseURL: options.baseUrl,
          context,
          model: options.model,
          persistArtifact: options.save,
          provider: options.provider,
          suite: "coding-v1",
          updateProfileCapabilities: options.updateProfileCapabilities,
          workerId: options.worker
        });

        writeOutput(
          io,
          {
            ...benchmarkUpdate.benchmarkResult,
            capabilityUpdateApplied:
              benchmarkUpdate.profileUpdate?.capabilityUpdateApplied ?? false,
            localClientRuntime: benchmarkUpdate.localClientRuntime,
            patchGenerationQualified:
              benchmarkUpdate.profileUpdate?.patchGenerationQualified ?? false,
            persistence: benchmarkUpdate.persistence,
            profilePersistence: benchmarkUpdate.profilePersistence
          },
          formatWorkerBenchmarkResult({
            ...benchmarkUpdate.benchmarkResult,
            capabilityUpdateApplied:
              benchmarkUpdate.profileUpdate?.capabilityUpdateApplied ?? false,
            localClientRuntime: benchmarkUpdate.localClientRuntime,
            patchGenerationQualified:
              benchmarkUpdate.profileUpdate?.patchGenerationQualified ?? false,
            persistence: benchmarkUpdate.persistence,
            profilePersistence: benchmarkUpdate.profilePersistence
          })
        );
      }
    );

  worker
    .command("readiness")
    .description("Explain whether a worker is ready for formal tasks right now.")
    .requiredOption("--worker <workerId>", "Worker id")
    .option("--probe", "Run a live connectivity probe before finalizing readiness", false)
    .action(async (options: { probe: boolean; worker: string }) => {
      const context = await resolveExecutionContext();
      const result = await buildWorkerReadinessReport({
        context,
        workerId: options.worker,
        probe: options.probe
      });

      writeOutput(io, result, formatWorkerReadinessResult(result));
    });

  worker
    .command("list")
    .description("List known worker capability profiles.")
    .action(async () => {
      const context = await resolveExecutionContext();
      const profiles = await listWorkerProfiles(
        context.rootDir,
        context.cwStorageDir
      );
      writeOutput(io, profiles, formatWorkerList("worker profiles", profiles));
    });

  worker
    .command("profile")
    .description("Get a worker capability profile by id.")
    .argument("<workerId>", "Worker profile id")
    .action(async (workerId: string) => {
      const context = await resolveExecutionContext();
      const resolvedWorkerId = requireConfiguredWorkerId(
        context,
        workerId,
        "worker profile lookup"
      );
      const profile = await getWorkerProfile(
        context.rootDir,
        resolvedWorkerId,
        context.cwStorageDir
      );

      if (!profile) {
        throw new Error(`No worker profile found for ${resolvedWorkerId}`);
      }

      writeOutput(
        io,
        serializeWorkerProfileResult(profile),
        formatWorkerProfileResult(profile)
      );
    });
};
