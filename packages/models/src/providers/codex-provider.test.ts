import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { ModelConfig } from "@mcp-code-worker/core";

interface MockChildProcess extends EventEmitter {
  stderr: PassThrough;
  stdin: PassThrough;
  stdinText: string;
  stdout: PassThrough;
}

const { inspectConfiguredCodexCommandMock, spawnMock } = vi.hoisted(() => ({
  inspectConfiguredCodexCommandMock: vi.fn(),
  spawnMock: vi.fn()
}));

const createMockChildProcess = (): MockChildProcess => {
  const child = new EventEmitter() as MockChildProcess;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdinText = "";
  child.stdin.setEncoding("utf8");
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdin.on("data", (chunk: string) => {
    child.stdinText += chunk;
  });
  return child;
};

const waitForSpawn = async (): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (spawnMock.mock.calls.length > 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("spawn was not called");
};

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

vi.mock("./codex-command.js", () => ({
  inspectConfiguredCodexCommand: inspectConfiguredCodexCommandMock
}));

import { CodexProvider } from "./codex-provider.js";

const config: ModelConfig = {
  provider: "codex",
  model: "gpt-5.4"
};

describe("CodexProvider", () => {
  beforeEach(() => {
    inspectConfiguredCodexCommandMock.mockReset();
    spawnMock.mockReset();
    inspectConfiguredCodexCommandMock.mockResolvedValue({
      command: "codex",
      compatibility: {
        checked: false,
        message: "Command resolution passed.",
        status: "pass"
      },
      configuredCommand: null,
      isPathLike: false,
      resolvedPath: "resolved-codex",
      source: "default",
      status: "pass"
    });
  });

  it("returns text results from Codex json event streams", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child);

    const provider = new CodexProvider();
    const pending = provider.invoke(config, {
      prompt: "Reply with exactly hello"
    });
    await waitForSpawn();

    expect(spawnMock).toHaveBeenCalledWith(
      "resolved-codex",
      [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--model",
        "gpt-5.4"
      ],
      {
        stdio: ["pipe", "pipe", "pipe"]
      }
    );

    child.stdout.end(
      [
        JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
        JSON.stringify({ type: "turn.started" }),
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_0",
            type: "agent_message",
            text: "hello"
          }
        }),
        JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: 12,
            output_tokens: 2
          }
        })
      ].join("\n")
    );
    child.stderr.end();
    child.emit("close", 0);

    const result = await pending;

    expect(child.stdinText).toBe("Reply with exactly hello");
    expect(result.text).toBe("hello");
    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 2
    });
  });

  it("passes system prompts through stdin and supports output schemas", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child);

    const provider = new CodexProvider();
    const pending = provider.invoke(config, {
      prompt: "Return JSON",
      systemPrompt: "Only return valid JSON.",
      responseFormat: "json",
      responseSchema: z.object({
        ok: z.boolean()
      })
    });
    await waitForSpawn();

    const args = spawnMock.mock.calls[0]?.[1] as string[];
    expect(args).toContain("--output-schema");
    expect(child.stdinText).toContain("System instructions:");
    expect(child.stdinText).toContain("Only return valid JSON.");
    expect(child.stdinText).toContain("User request:");

    child.stdout.end(
      [
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_0",
            type: "agent_message",
            text: "{\"ok\":true}"
          }
        }),
        JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: 8,
            output_tokens: 4
          }
        })
      ].join("\n")
    );
    child.stderr.end();
    child.emit("close", 0);

    const result = await pending;

    expect(result.text).toBe("{\"ok\":true}");
  });

  it("throws when Codex emits an error event", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child);

    const provider = new CodexProvider();
    const pending = provider.invoke(config, {
      prompt: "Reply with exactly hello"
    });
    await waitForSpawn();

    child.stdout.end(
      JSON.stringify({
        type: "error",
        message: "authentication failed"
      })
    );
    child.stderr.end();
    child.emit("close", 0);

    await expect(pending).rejects.toThrow(
      "Codex worker returned an error event: authentication failed"
    );
  });
});
