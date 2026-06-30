import { describe, expect, it } from "vitest";

import { parseCodexEventStream } from "./codex-event-stream.js";

describe("parseCodexEventStream", () => {
  it("collects agent_message events and turn token usage", () => {
    const result = parseCodexEventStream(
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
            cached_input_tokens: 5,
            output_tokens: 2,
            reasoning_output_tokens: 1
          }
        })
      ].join("\n")
    );

    expect(result.text).toBe("hello");
    expect(result.usage).toEqual({
      inputTokens: 12,
      cachedInputTokens: 5,
      outputTokens: 2,
      reasoningOutputTokens: 1
    });
    expect(result.events).toHaveLength(4);
  });

  it("surfaces error events", () => {
    const result = parseCodexEventStream(
      JSON.stringify({
        type: "error",
        message: "authentication failed"
      })
    );

    expect(result.error).toBe("authentication failed");
  });
});
