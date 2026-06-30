import { z } from "zod";

import { qualifiesPatchGenerationCapability } from "@mcp-code-worker/core";
import {
  runWorkerBenchmarkOnboarding
} from "@mcp-code-worker/graph";

import { resolveToolContext } from "./tool-runtime.js";
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
  Awaited<ReturnType<typeof runWorkerBenchmarkOnboarding>>["benchmarkResult"] & {
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

    const context = await resolveToolContext();
    const result = await runWorkerBenchmarkOnboarding({
      baseURL: args.baseURL,
      context,
      model: args.model,
      persistArtifact: args.persistArtifact ?? false,
      provider: args.provider,
      suite,
      updateProfileCapabilities: args.updateProfileCapabilities ?? false,
      workerId: args.workerId
    });

    return {
      ...result.benchmarkResult,
      capabilityUpdateApplied: result.profileUpdate?.capabilityUpdateApplied ?? false,
      patchGenerationQualified:
        result.profileUpdate?.patchGenerationQualified ??
        qualifiesPatchGenerationCapability(result.benchmarkResult),
      ...(result.persistence ? { persistence: result.persistence } : {}),
      ...(result.profilePersistence
        ? { profilePersistence: result.profilePersistence }
        : {})
    };
  }
};
