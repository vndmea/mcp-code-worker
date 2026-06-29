import { z } from "zod";

import { resolveExecutionContext } from "@mcp-code-worker/core";
import {
  applyBenchmarkCapabilityUpdate,
  runWorkerBenchmarkWorkflow,
  saveWorkerBenchmarkArtifact
} from "@mcp-code-worker/graph";
import {
  getWorkerProfile,
  resolveWorkerTarget,
  saveWorkerProfile
} from "@mcp-code-worker/models";

import type { CwToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  suite: z.literal("coding-v1").optional(),
  workerId: z.string().min(1),
  provider: z.string().optional(),
  model: z.string().optional(),
  baseURL: z.string().optional(),
  persistArtifact: z.boolean().optional(),
  updateProfileCapabilities: z.boolean().optional()
});

export const cwBenchmarkWorkerTool: CwToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof runWorkerBenchmarkWorkflow>> & {
    capabilityUpdateApplied: boolean;
    patchGenerationQualified: boolean;
    persistence?: { mode: "execute" | "dry-run"; path: string };
    profilePersistence?: { mode: "execute" | "dry-run"; path: string };
  }
> = {
  name: "cw_benchmark_worker",
  description:
    "Run the coding benchmark suite for a worker model, optionally persist the artifact, and optionally update persisted worker capabilities.",
  inputSchema,
  execute: async (args) => {
    const suite = args.suite ?? "coding-v1";

    if (args.updateProfileCapabilities && !args.persistArtifact) {
      throw new Error("updateProfileCapabilities requires persistArtifact.");
    }

    const context = await resolveExecutionContext();
    const resolvedTarget = await resolveWorkerTarget({
      context,
      workerId: args.workerId,
      provider: args.provider,
      model: args.model,
      baseURL: args.baseURL,
      requireNamedWorker: true
    });
    const result = await runWorkerBenchmarkWorkflow({
      context,
      suite,
      workerId: resolvedTarget.workerId,
      modelConfig: resolvedTarget.modelConfig
    });
    const persistence = args.persistArtifact
      ? await saveWorkerBenchmarkArtifact(context, result, true)
      : undefined;
    const existingProfile = await getWorkerProfile(
      context.rootDir,
      result.workerId,
      context.cwStorageDir
    );

    if (args.updateProfileCapabilities && !existingProfile) {
      throw new Error(
        `No persisted worker profile was found for '${result.workerId}'. Run cw_run_worker_interview with workerId='${result.workerId}' and persistProfile=true first.`
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
