import { z } from "zod";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import {
  applyBenchmarkCapabilityUpdate,
  runWorkerBenchmarkWorkflow,
  saveWorkerBenchmarkArtifact
} from "@agent-orchestrator/graph";
import {
  getWorkerProfile,
  getWorkerRegistration,
  resolveWorkerModel,
  saveWorkerProfile
} from "@agent-orchestrator/models";

import type { AoToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  suite: z.literal("coding-v1").optional(),
  workerId: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  baseURL: z.string().optional(),
  persistArtifact: z.boolean().optional(),
  updateProfileCapabilities: z.boolean().optional()
});

export const aoBenchmarkWorkerTool: AoToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof runWorkerBenchmarkWorkflow>> & {
    capabilityUpdateApplied: boolean;
    patchGenerationQualified: boolean;
    persistence?: { mode: "execute" | "dry-run"; path: string };
    profilePersistence?: { mode: "execute" | "dry-run"; path: string };
  }
> = {
  name: "ao_benchmark_worker",
  description:
    "Run the coding benchmark suite for a worker model, optionally persist the artifact, and optionally update persisted worker capabilities.",
  inputSchema,
  execute: async (args) => {
    const suite = args.suite ?? "coding-v1";

    if (args.updateProfileCapabilities && !args.persistArtifact) {
      throw new Error("updateProfileCapabilities requires persistArtifact.");
    }

    const context = await resolveExecutionContext();
    const hasModelOverride =
      Boolean(args.provider) || Boolean(args.model) || Boolean(args.baseURL);
    const registeredWorker = args.workerId
      ? await getWorkerRegistration(
          context.rootDir,
          args.workerId,
          context.aoStorageDir
        )
      : null;
    const resolved = registeredWorker
      ? await resolveWorkerModel({
          context,
          workerId: args.workerId
        })
      : null;

    if (args.workerId && !registeredWorker && !hasModelOverride) {
      throw new Error(`Worker ${args.workerId} is not registered.`);
    }

    const modelConfig = resolved?.modelConfig ?? {
      ...context.workerModel,
      ...(args.provider ? { provider: args.provider } : {}),
      ...(args.model ? { model: args.model } : {}),
      ...(args.baseURL ? { baseURL: args.baseURL } : {})
    };
    const result = await runWorkerBenchmarkWorkflow({
      context,
      suite,
      workerId: resolved?.workerId ?? args.workerId,
      modelConfig
    });
    const persistence = args.persistArtifact
      ? await saveWorkerBenchmarkArtifact(context, result, true)
      : undefined;
    const existingProfile = await getWorkerProfile(
      context.rootDir,
      result.workerId,
      context.aoStorageDir
    );

    if (args.updateProfileCapabilities && !existingProfile) {
      throw new Error(
        `No persisted worker profile found for ${result.workerId}; run ao_interview_worker with persistProfile first.`
      );
    }

    const profileUpdate = existingProfile
      ? applyBenchmarkCapabilityUpdate(existingProfile, result, {
          updateProfileCapabilities: args.updateProfileCapabilities
        })
      : null;
    const profilePersistence =
      args.persistArtifact && profileUpdate
        ? await saveWorkerProfile(context, profileUpdate.profile, true)
        : undefined;

    return {
      ...result,
      capabilityUpdateApplied: profileUpdate?.capabilityUpdateApplied ?? false,
      patchGenerationQualified: profileUpdate?.patchGenerationQualified ?? false,
      ...(persistence ? { persistence } : {}),
      ...(profilePersistence ? { profilePersistence } : {})
    };
  }
};
