export interface CodexEventStreamUsage {
  cachedInputTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
}

export interface ParsedCodexEventStream {
  error?: string;
  events: unknown[];
  text: string;
  usage?: CodexEventStreamUsage;
}

interface CodexEventRecord {
  error?: {
    message?: string;
  };
  item?: {
    text?: string;
    type?: string;
  };
  message?: string;
  type?: string;
  usage?: {
    cached_input_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
  };
}

const formatUnknownError = (value: unknown): string =>
  value instanceof Error ? value.message : String(value);

export const parseCodexEventStream = (
  stdout: string
): ParsedCodexEventStream => {
  const events: unknown[] = [];
  const textParts: string[] = [];
  let usage: CodexEventStreamUsage | undefined;
  let error: string | undefined;

  for (const rawLine of stdout.split(/\r?\n/gu)) {
    const line = rawLine.trim();

    if (line.length === 0) {
      continue;
    }

    let parsed: CodexEventRecord;
    try {
      parsed = JSON.parse(line) as CodexEventRecord;
    } catch (parseError) {
      throw new Error(
        `Failed to parse codex event stream line as JSON: ${formatUnknownError(parseError)}`
      );
    }

    events.push(parsed);

    if (
      parsed.type === "item.completed" &&
      parsed.item?.type === "agent_message" &&
      typeof parsed.item.text === "string"
    ) {
      textParts.push(parsed.item.text);
      continue;
    }

    if (parsed.type === "turn.completed" && parsed.usage) {
      usage = {
        ...(parsed.usage.input_tokens !== undefined
          ? { inputTokens: parsed.usage.input_tokens }
          : {}),
        ...(parsed.usage.cached_input_tokens !== undefined
          ? { cachedInputTokens: parsed.usage.cached_input_tokens }
          : {}),
        ...(parsed.usage.output_tokens !== undefined
          ? { outputTokens: parsed.usage.output_tokens }
          : {}),
        ...(parsed.usage.reasoning_output_tokens !== undefined
          ? { reasoningOutputTokens: parsed.usage.reasoning_output_tokens }
          : {})
      };
      continue;
    }

    if (parsed.type === "error" || parsed.type === "turn.failed") {
      error =
        parsed.message ??
        parsed.error?.message ??
        "Codex returned an error event.";
    }
  }

  return {
    text: textParts.join("\n"),
    events,
    ...(usage ? { usage } : {}),
    ...(error ? { error } : {})
  };
};
