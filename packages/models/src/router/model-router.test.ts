import { describe, expect, it } from "vitest";

import { ModelRouter } from "@mcp-code-worker/models";

describe("model router", () => {
  it("routes every role to the configured worker model", () => {
    const router = new ModelRouter({
      provider: "mock",
      model: "worker-model"
    });

    expect(router.route("worker").config.model).toBe("worker-model");
    expect(router.route("reviewer").config.model).toBe("worker-model");
    expect(router.listModels()).toEqual([
      expect.objectContaining({
        role: "worker",
        model: "worker-model"
      })
    ]);
  });

  it("routes claude-compatible workers to the anthropic provider", () => {
    const router = new ModelRouter({
      provider: "claude-compatible",
      model: "claude-3-5-sonnet-latest"
    });

    expect(router.route("worker").provider.name).toBe("anthropic");
  });

  it("routes opencode workers to the dedicated opencode provider", () => {
    const router = new ModelRouter({
      provider: "opencode",
      model: "deepseek/deepseek-v4-flash"
    });

    expect(router.route("worker").provider.name).toBe("opencode");
  });

  it("routes claudecode workers to the dedicated Claude Code provider", () => {
    const router = new ModelRouter({
      provider: "claudecode",
      model: "sonnet"
    });

    expect(router.route("worker").provider.name).toBe("claudecode");
  });

  it("routes codex workers to the dedicated Codex provider", () => {
    const router = new ModelRouter({
      provider: "codex",
      model: "gpt-5.4"
    });

    expect(router.route("worker").provider.name).toBe("codex");
  });

  it("rejects removed provider aliases instead of silently routing them", () => {
    const router = new ModelRouter({
      provider: "anthropic",
      model: "claude-3-5-sonnet-latest"
    });

    expect(() => router.route("worker")).toThrow("Unsupported worker provider 'anthropic'");
    expect(
      () =>
        new ModelRouter({
          provider: "local-client",
          model: "qwen3-coder"
        }).route("worker")
    ).toThrow("Unsupported worker provider 'local-client'");
    expect(
      () =>
        new ModelRouter({
          provider: "openai",
          model: "gpt-4.1"
        }).route("worker")
    ).toThrow("Unsupported worker provider 'openai'");
  });
});
