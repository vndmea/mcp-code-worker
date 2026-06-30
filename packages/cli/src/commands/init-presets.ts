import type { ModelConfig } from "@mcp-code-worker/core";

export type InitPresetId = "mock" | "deepseek" | "client" | "opencode" | "claudecode" | "codex";

export interface InitPresetDefinition {
  id: InitPresetId;
  label: string;
  workerBaseUrl?: string;
  workerClientCommand?: string;
  workerModel: string;
  workerProvider: string;
}

export const INIT_PRESETS: InitPresetDefinition[] = [
  {
    id: "mock",
    label: "Mock",
    workerModel: "gpt-5.4-mini",
    workerProvider: "mock"
  },
  {
    id: "deepseek",
    label: "DeepSeek API",
    workerBaseUrl: "https://api.deepseek.com",
    workerModel: "deepseek-v4-flash",
    workerProvider: "openai-compatible"
  },
  {
    id: "client",
    label: "Local Client",
    workerModel: "qwen3-coder",
    workerProvider: "client"
  },
  {
    id: "opencode",
    label: "OpenCode Adapter",
    workerModel: "deepseek/deepseek-v4-flash",
    workerProvider: "opencode"
  },
  {
    id: "claudecode",
    label: "Claude Code Adapter",
    workerModel: "sonnet",
    workerProvider: "claudecode"
  },
  {
    id: "codex",
    label: "Codex Adapter",
    workerModel: "gpt-5.4",
    workerProvider: "codex"
  }
];

export const getInitPreset = (
  presetId: string | undefined
): InitPresetDefinition | undefined =>
  presetId
    ? INIT_PRESETS.find((preset) => preset.id === presetId)
    : undefined;

export const detectInitPreset = (
  workerModel: ModelConfig
): InitPresetId | undefined => {
  if (
    workerModel.provider === "mock" &&
    workerModel.model === "gpt-5.4-mini"
  ) {
    return "mock";
  }

  if (
    workerModel.provider === "openai-compatible" &&
    workerModel.model === "deepseek-v4-flash" &&
    workerModel.baseURL === "https://api.deepseek.com"
  ) {
    return "deepseek";
  }

  if (
    workerModel.provider === "client" &&
    workerModel.model === "qwen3-coder" &&
    (!workerModel.clientCommand ||
      workerModel.clientCommand === "sparkcode")
  ) {
    return "client";
  }

  if (
    workerModel.provider === "opencode" &&
    workerModel.model === "deepseek/deepseek-v4-flash" &&
    (!workerModel.clientCommand ||
      workerModel.clientCommand === "opencode")
  ) {
    return "opencode";
  }

  if (
    workerModel.provider === "claudecode" &&
    workerModel.model === "sonnet" &&
    (!workerModel.clientCommand ||
      workerModel.clientCommand === "claude")
  ) {
    return "claudecode";
  }

  if (
    workerModel.provider === "codex" &&
    workerModel.model === "gpt-5.4" &&
    (!workerModel.clientCommand ||
      workerModel.clientCommand === "codex")
  ) {
    return "codex";
  }

  return undefined;
};
