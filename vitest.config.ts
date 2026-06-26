import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolvePath = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@agent-orchestrator/cli": resolvePath("./packages/cli/src/index.ts"),
      "@agent-orchestrator/core": resolvePath("./packages/core/src/index.ts"),
      "@agent-orchestrator/graph": resolvePath("./packages/graph/src/index.ts"),
      "@agent-orchestrator/mcp-server": resolvePath(
        "./packages/mcp-server/src/index.ts"
      ),
      "@agent-orchestrator/models": resolvePath("./packages/models/src/index.ts"),
      "@agent-orchestrator/tools": resolvePath("./packages/tools/src/index.ts")
    }
  },
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["packages/**/*.test.ts"],
    maxWorkers: 1,
    minWorkers: 1,
    setupFiles: ["./vitest.setup.ts"]
  }
});
