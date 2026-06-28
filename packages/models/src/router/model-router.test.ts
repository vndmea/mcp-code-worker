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

  it("routes anthropic alias workers to the anthropic provider", () => {
    const router = new ModelRouter({
      provider: "anthropic",
      model: "claude-3-5-sonnet-latest"
    });

    expect(router.route("worker").provider.name).toBe("anthropic");
  });
});
