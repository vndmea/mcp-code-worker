import { describe, expect, it } from "vitest";

import { ModelRouter } from "@agent-orchestrator/models";

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
});
