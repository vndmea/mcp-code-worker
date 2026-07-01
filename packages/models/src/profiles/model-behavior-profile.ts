import { z } from "zod";

import {
  WorkerTaskTypeSchema,
  type ModelConfig
} from "@mcp-code-worker/core";

import type { ModelStructuredOutputMode } from "../types/model-provider.js";

const StructuredJsonCapabilitySchema = z.enum([
  "supported",
  "unsupported",
  "unknown"
]);

const RepairPromptPolicySchema = z.enum(["format-only"]);

const StructuredOutputPreferredModeSchema = z.enum([
  "native-json-schema",
  "prompt-only-json"
]) satisfies z.ZodType<Exclude<ModelStructuredOutputMode, "none">>;

export const ModelBehaviorProfileSchema = z
  .object({
    id: z.string().min(1),
    provider: z.string().min(1),
    modelPattern: z.string().min(1),
    recommendedTemperature: z.number().min(0).max(2),
    structuredOutput: z
      .object({
        nativeJsonSchema: StructuredJsonCapabilitySchema,
        preferredMode: StructuredOutputPreferredModeSchema,
        repairAttempts: z.number().int().min(1).max(5),
        repairPromptPolicy: RepairPromptPolicySchema
      })
      .strict(),
    allowedTaskTypes: z.array(WorkerTaskTypeSchema).optional(),
    avoidTaskShapes: z.array(z.string().min(1)),
    notes: z.array(z.string().min(1))
  })
  .strict();

export type ModelBehaviorProfile = z.infer<typeof ModelBehaviorProfileSchema>;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const wildcardToRegExp = (pattern: string): RegExp =>
  new RegExp(
    `^${pattern.split("*").map(escapeRegExp).join(".*")}$`,
    "iu"
  );

const matchesPattern = (pattern: string, value: string): boolean =>
  wildcardToRegExp(pattern).test(value);

const profile = (
  value: ModelBehaviorProfile
): ModelBehaviorProfile => ModelBehaviorProfileSchema.parse(value);

export const MODEL_BEHAVIOR_PROFILES: ModelBehaviorProfile[] = [
  profile({
    id: "codex-native-structured",
    provider: "codex",
    modelPattern: "*",
    recommendedTemperature: 0.1,
    structuredOutput: {
      nativeJsonSchema: "supported",
      preferredMode: "native-json-schema",
      repairAttempts: 2,
      repairPromptPolicy: "format-only"
    },
    avoidTaskShapes: [],
    notes: [
      "Codex provider passes a JSON schema file through the CLI output-schema path."
    ]
  }),
  profile({
    id: "local-client-native-structured",
    provider: "client",
    modelPattern: "*",
    recommendedTemperature: 0.1,
    structuredOutput: {
      nativeJsonSchema: "supported",
      preferredMode: "native-json-schema",
      repairAttempts: 2,
      repairPromptPolicy: "format-only"
    },
    avoidTaskShapes: [],
    notes: [
      "Generic local client adapter exposes a json-schema argument when the command supports it."
    ]
  }),
  profile({
    id: "claudecode-native-structured",
    provider: "claudecode",
    modelPattern: "*",
    recommendedTemperature: 0.1,
    structuredOutput: {
      nativeJsonSchema: "supported",
      preferredMode: "native-json-schema",
      repairAttempts: 2,
      repairPromptPolicy: "format-only"
    },
    avoidTaskShapes: [],
    notes: [
      "Claude Code adapter exposes a json-schema argument for structured output."
    ]
  }),
  profile({
    id: "opencode-prompt-json",
    provider: "opencode",
    modelPattern: "*",
    recommendedTemperature: 0.2,
    structuredOutput: {
      nativeJsonSchema: "unknown",
      preferredMode: "prompt-only-json",
      repairAttempts: 2,
      repairPromptPolicy: "format-only"
    },
    avoidTaskShapes: [
      "Do not use as the first-phase API model path."
    ],
    notes: [
      "Current OpenCode adapter uses JSON event output but does not pass task-specific schemas."
    ]
  }),
  profile({
    id: "deepseek-openai-compatible-prompt-json",
    provider: "openai-compatible",
    modelPattern: "*deepseek*",
    recommendedTemperature: 0.1,
    structuredOutput: {
      nativeJsonSchema: "unsupported",
      preferredMode: "prompt-only-json",
      repairAttempts: 2,
      repairPromptPolicy: "format-only"
    },
    avoidTaskShapes: [
      "Large unconstrained prose-plus-JSON responses",
      "Tasks that require accepting uncited repository claims"
    ],
    notes: [
      "Prefer prompt-only JSON and host validation for DeepSeek-compatible API models."
    ]
  }),
  profile({
    id: "deepseek-litellm-prompt-json",
    provider: "litellm",
    modelPattern: "*deepseek*",
    recommendedTemperature: 0.1,
    structuredOutput: {
      nativeJsonSchema: "unsupported",
      preferredMode: "prompt-only-json",
      repairAttempts: 2,
      repairPromptPolicy: "format-only"
    },
    avoidTaskShapes: [
      "Large unconstrained prose-plus-JSON responses",
      "Tasks that require accepting uncited repository claims"
    ],
    notes: [
      "LiteLLM DeepSeek routes should not hide native schema incompatibility."
    ]
  }),
  profile({
    id: "qwen-openai-compatible-prompt-json",
    provider: "openai-compatible",
    modelPattern: "*qwen*",
    recommendedTemperature: 0.1,
    structuredOutput: {
      nativeJsonSchema: "unknown",
      preferredMode: "prompt-only-json",
      repairAttempts: 2,
      repairPromptPolicy: "format-only"
    },
    avoidTaskShapes: [
      "Tasks that depend on unstated cross-file edits"
    ],
    notes: [
      "Keep Qwen API model output contract-first until native schema behavior is proven."
    ]
  }),
  profile({
    id: "kimi-openai-compatible-prompt-json",
    provider: "openai-compatible",
    modelPattern: "*kimi*",
    recommendedTemperature: 0.1,
    structuredOutput: {
      nativeJsonSchema: "unknown",
      preferredMode: "prompt-only-json",
      repairAttempts: 2,
      repairPromptPolicy: "format-only"
    },
    avoidTaskShapes: [
      "Tasks that require accepting uncited repository claims"
    ],
    notes: [
      "Keep Kimi API model output contract-first until native schema behavior is proven."
    ]
  }),
  profile({
    id: "moonshot-openai-compatible-prompt-json",
    provider: "openai-compatible",
    modelPattern: "*moonshot*",
    recommendedTemperature: 0.1,
    structuredOutput: {
      nativeJsonSchema: "unknown",
      preferredMode: "prompt-only-json",
      repairAttempts: 2,
      repairPromptPolicy: "format-only"
    },
    avoidTaskShapes: [
      "Tasks that require accepting uncited repository claims"
    ],
    notes: [
      "Moonshot/Kimi model aliases share the same first-phase prompt-only JSON posture."
    ]
  }),
  profile({
    id: "default-api-model",
    provider: "*",
    modelPattern: "*",
    recommendedTemperature: 0.2,
    structuredOutput: {
      nativeJsonSchema: "unknown",
      preferredMode: "native-json-schema",
      repairAttempts: 2,
      repairPromptPolicy: "format-only"
    },
    avoidTaskShapes: [
      "Do not accept JSON that passes schema but fails task semantic validation."
    ],
    notes: [
      "Default profile tries native JSON schema but must surface fallback mode explicitly."
    ]
  })
];

export const listModelBehaviorProfiles = (): ModelBehaviorProfile[] => [
  ...MODEL_BEHAVIOR_PROFILES
];

export const resolveModelBehaviorProfile = (
  config: Pick<ModelConfig, "provider" | "model">
): ModelBehaviorProfile => {
  const match = MODEL_BEHAVIOR_PROFILES.find(
    (candidate) =>
      matchesPattern(candidate.provider, config.provider) &&
      matchesPattern(candidate.modelPattern, config.model)
  );

  if (!match) {
    throw new Error(
      `No model behavior profile matched ${config.provider}/${config.model}.`
    );
  }

  return match;
};
