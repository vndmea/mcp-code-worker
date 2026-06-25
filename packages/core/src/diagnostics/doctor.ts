import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

import type { ExecutionContext } from "../runtime/execution-context.js";

export interface DoctorCheck {
  message: string;
  metadata?: Record<string, unknown>;
  name: string;
  status: "pass" | "warning" | "fail";
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
  recommendedActions: string[];
}

export interface RunDoctorOptions {
  additionalChecks?: DoctorCheck[];
}

const checkExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const canWrite = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

export const runDoctor = async (
  context: ExecutionContext,
  options: RunDoctorOptions = {}
): Promise<DoctorReport> => {
  const checks: DoctorCheck[] = [];
  const recommendedActions: string[] = [];
  const rootDirExists = await checkExists(context.rootDir);

  checks.push({
    name: "root-dir",
    status: rootDirExists ? "pass" : "fail",
    message: rootDirExists
      ? `Resolved rootDir exists: ${context.rootDir}`
      : `Resolved rootDir does not exist: ${context.rootDir}`,
    metadata: {
      rootDir: context.rootDir
    }
  });

  checks.push({
    name: "leader-model",
    status:
      context.leaderModel.provider.length > 0 && context.leaderModel.model.length > 0
        ? "pass"
        : "fail",
    message: `Resolved leader model: ${context.leaderModel.provider}:${context.leaderModel.model}`,
    metadata: {
      model: context.leaderModel.model,
      provider: context.leaderModel.provider
    }
  });

  checks.push({
    name: "worker-model",
    status:
      context.workerModel.provider.length > 0 && context.workerModel.model.length > 0
        ? "pass"
        : "fail",
    message: `Resolved worker model: ${context.workerModel.provider}:${context.workerModel.model}`,
    metadata: {
      model: context.workerModel.model,
      provider: context.workerModel.provider
    }
  });

  const aoDir = join(context.rootDir, ".ao");
  const aoDirExists = rootDirExists ? await checkExists(aoDir) : false;
  const aoDirWritable = aoDirExists
    ? await canWrite(aoDir)
    : rootDirExists
      ? await canWrite(context.rootDir)
      : false;

  checks.push({
    name: "ao-dir",
    status: aoDirWritable ? "pass" : "fail",
    message: aoDirExists
      ? aoDirWritable
        ? ".ao directory is writable."
        : ".ao directory exists but is not writable."
      : aoDirWritable
        ? ".ao directory does not exist, but the repository root is writable so it can be created."
        : ".ao directory does not exist and the repository root is not writable.",
    metadata: {
      aoDir,
      exists: aoDirExists
    }
  });

  checks.push({
    name: "execution-mode",
    status: "pass",
    message: `Execution mode resolved to ${context.dryRun ? "dry-run" : "execute"} with allowWrite=${String(context.allowWrite)}.`,
    metadata: {
      allowWrite: context.allowWrite,
      dryRun: context.dryRun
    }
  });

  checks.push({
    name: "allowed-commands",
    status: "pass",
    message: `Allowed commands: ${context.allowedCommands.join(", ") || "(none)"}`,
    metadata: {
      allowedCommands: context.allowedCommands
    }
  });

  const envPath = join(context.rootDir, ".env");
  const envExists = rootDirExists ? await checkExists(envPath) : false;
  checks.push({
    name: "env-file",
    status: envExists ? "pass" : "warning",
    message: envExists
      ? ".env file is present."
      : ".env file is not present. This is informational only if configuration is resolved elsewhere.",
    metadata: {
      envPath,
      exists: envExists
    }
  });

  options.additionalChecks?.forEach((check) => {
    checks.push(check);
  });

  checks.forEach((check) => {
    if (check.status === "fail") {
      recommendedActions.push(`Fix ${check.name}: ${check.message}`);
    }
  });

  return {
    ok: checks.every((check) => check.status !== "fail"),
    checks,
    recommendedActions
  };
};
