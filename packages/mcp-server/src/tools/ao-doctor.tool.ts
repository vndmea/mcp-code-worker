import { z } from "zod";

import { createExecutionContextFromEnv, runDoctor } from "@agent-orchestrator/core";
import { createWorkerProfileDoctorChecks } from "@agent-orchestrator/models";

import type { AoToolDefinition } from "./tool-types.js";

const inputSchema = z.object({});

export const aoDoctorTool: AoToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof runDoctor>>
> = {
  name: "ao_doctor",
  description: "Inspect resolved configuration and local workflow prerequisites.",
  inputSchema,
  execute: async () => {
    const context = createExecutionContextFromEnv();

    return runDoctor(context, {
      additionalChecks: await createWorkerProfileDoctorChecks(context)
    });
  }
};
