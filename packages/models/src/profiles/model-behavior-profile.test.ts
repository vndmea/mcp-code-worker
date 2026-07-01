import { describe, expect, it } from "vitest";

import {
  listModelBehaviorProfiles,
  ModelBehaviorProfileSchema,
  resolveModelBehaviorProfile
} from "@mcp-code-worker/models";

describe("ModelBehaviorProfile registry", () => {
  it("keeps all registered profiles schema-valid", () => {
    const profiles = listModelBehaviorProfiles();

    expect(profiles.length).toBeGreaterThan(0);
    for (const profile of profiles) {
      expect(ModelBehaviorProfileSchema.safeParse(profile).success).toBe(true);
    }
  });

  it("resolves DeepSeek API models to prompt-only JSON", () => {
    const profile = resolveModelBehaviorProfile({
      provider: "openai-compatible",
      model: "deepseek-v4-pro"
    });

    expect(profile.id).toBe("deepseek-openai-compatible-prompt-json");
    expect(profile.structuredOutput.preferredMode).toBe("prompt-only-json");
    expect(profile.structuredOutput.nativeJsonSchema).toBe("unsupported");
  });

  it("resolves Qwen and Kimi aliases before the default profile", () => {
    expect(
      resolveModelBehaviorProfile({
        provider: "openai-compatible",
        model: "qwen3-coder"
      }).id
    ).toBe("qwen-openai-compatible-prompt-json");

    expect(
      resolveModelBehaviorProfile({
        provider: "openai-compatible",
        model: "moonshot-kimi-k2"
      }).id
    ).toBe("kimi-openai-compatible-prompt-json");
  });

  it("resolves Codex to native structured output", () => {
    const profile = resolveModelBehaviorProfile({
      provider: "codex",
      model: "gpt-5-codex"
    });

    expect(profile.structuredOutput.preferredMode).toBe("native-json-schema");
    expect(profile.structuredOutput.nativeJsonSchema).toBe("supported");
  });

  it("falls back to the default API model profile", () => {
    const profile = resolveModelBehaviorProfile({
      provider: "openai-compatible",
      model: "unknown-model"
    });

    expect(profile.id).toBe("default-api-model");
    expect(profile.structuredOutput.preferredMode).toBe("native-json-schema");
  });
});
