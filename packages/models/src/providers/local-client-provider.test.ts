import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { ModelConfig } from "@agent-orchestrator/core";

interface MockChildProcess extends EventEmitter {
  stderr: PassThrough;
  stdin: PassThrough;
  stdout: PassThrough;
  stdinText: string;
}

const { spawnMock } = vi.hoisted(() => ({
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

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

import { LocalClientProvider } from "@agent-orchestrator/models";

const config: ModelConfig = {
  provider: "client",
  model: "qwen3-coder"
};

describe("LocalClientProvider", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    delete process.env.AO_WORKER_CLIENT_COMMAND;
  });

  it("returns text results from client json output", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child);

    const provider = new LocalClientProvider();
    const pending = provider.invoke(config, {
      prompt: "Reply with exactly hello"
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "opencode",
      [
        "-p",
        "--tools",
        "",
        "--permission-mode",
        "dontAsk",
        "--output-format",
        "json",
        "--model",
        "qwen3-coder"
      ],
      {
        stdio: ["pipe", "pipe", "pipe"]
      }
    );

    child.stdout.end(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "hello",
        usage: {
          input_tokens: 12,
          output_tokens: 2
        }
      })
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

  it("returns structured output when a json schema is requested", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child);

    const provider = new LocalClientProvider();
    const pending = provider.invoke(config, {
      prompt: "Return JSON",
      systemPrompt: "Only return valid JSON.",
      responseFormat: "json",
      responseSchema: z.object({
        ok: z.boolean(),
        message: z.string()
      })
    });

    const args = spawnMock.mock.calls[0]?.[1] as string[];
    expect(args).toContain("--system-prompt");
    expect(args).toContain("Only return valid JSON.");
    expect(args).toContain("--json-schema");
    expect(args.at(-1)).toContain("\"type\":\"object\"");

    child.stdout.end(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "ignored",
        structured_output: {
          ok: true,
          message: "hello"
        }
      })
    );
    child.stderr.end();
    child.emit("close", 0);

    const result = await pending;

    expect(result.text).toBe("{\"ok\":true,\"message\":\"hello\"}");
  });

  it("throws when the local client exits with a failure code", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child);

    const provider = new LocalClientProvider();
    const pending = provider.invoke(config, {
      prompt: "Reply with exactly hello"
    });

    child.stdout.end();
    child.stderr.end("authentication failed");
    child.emit("close", 1);

    await expect(pending).rejects.toThrow(
      "Local client worker exited with code 1: authentication failed"
    );
  });

  it("uses the configured client command override when provided", async () => {
    process.env.AO_WORKER_CLIENT_COMMAND = "custom-client";
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child);

    const provider = new LocalClientProvider();
    const pending = provider.invoke(config, {
      prompt: "Reply with exactly hello"
    });

    expect(spawnMock.mock.calls[0]?.[0]).toBe("custom-client");

    child.stdout.end(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "hello"
      })
    );
    child.stderr.end();
    child.emit("close", 0);

    await pending;
  });
});
