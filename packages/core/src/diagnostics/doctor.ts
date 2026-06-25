import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

import { listAuditEvents } from "../audit/audit-log.js";
import { loadAoConfig } from "../config/ao-config.js";
import type { ExecutionContext } from "../runtime/execution-context.js";
import { scanTaskSessions } from "../session/task-session-store.js";

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

const readRootScripts = async (
  rootDir: string
): Promise<Record<string, string>> => {
  try {
    const packageJson = await import("node:fs/promises").then(({ readFile }) =>
      readFile(join(rootDir, "package.json"), "utf8")
    );
    const parsed = JSON.parse(packageJson) as { scripts?: Record<string, string> };
    return parsed.scripts ?? {};
  } catch {
    return {};
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

  const config = await loadAoConfig(context.rootDir);
  checks.push({
    name: "ao-config",
    status: config.error ? "fail" : config.exists ? "pass" : "warning",
    message: config.error
      ? `.ao/config.json is invalid: ${config.error}`
      : config.exists
        ? ".ao/config.json is present and readable."
        : ".ao/config.json is missing. Defaults and environment variables will still work.",
    metadata: {
      path: config.path
    }
  });

  const apiKeyChecks = [
    {
      name: "leader-api-key",
      provider: context.leaderModel.provider,
      envVar:
        config.config.leaderModel?.apiKeyEnvVar ?? "LEADER_MODEL_API_KEY",
      hasKey: Boolean(context.leaderModel.apiKey)
    },
    {
      name: "worker-api-key",
      provider: context.workerModel.provider,
      envVar:
        config.config.workerModel?.apiKeyEnvVar ?? "WORKER_MODEL_API_KEY",
      hasKey: Boolean(context.workerModel.apiKey)
    }
  ];

  apiKeyChecks.forEach((entry) => {
    checks.push({
      name: entry.name,
      status:
        entry.provider === "mock"
          ? "pass"
          : entry.hasKey
            ? "pass"
            : "warning",
      message:
        entry.provider === "mock"
          ? `${entry.name} is using a mock provider and does not require a key.`
          : entry.hasKey
            ? `${entry.name} resolved successfully from ${entry.envVar}.`
            : `${entry.name} is not set. Expected ${entry.envVar} for provider ${entry.provider}.`,
      metadata: {
        envVar: entry.envVar,
        provider: entry.provider
      }
    });
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

  const runsDir = join(aoDir, "runs");
  const runsDirExists = rootDirExists ? await checkExists(runsDir) : false;
  const sessionScan = rootDirExists
    ? await scanTaskSessions(context.rootDir)
    : {
        sessions: [],
        invalidSessions: []
      };
  const failedSessions = sessionScan.sessions.filter(
    (session) => session.status === "failed" || session.status === "blocked"
  );
  checks.push({
    name: "runs-dir",
    status: runsDirExists ? "pass" : "warning",
    message: runsDirExists
      ? `.ao/runs is present with ${sessionScan.sessions.length} valid session(s).`
      : ".ao/runs is not present yet. It can be created when task sessions are persisted.",
    metadata: {
      runsDir,
      exists: runsDirExists
    }
  });
  checks.push({
    name: "task-sessions",
    status:
      sessionScan.invalidSessions.length > 0 || failedSessions.length > 0
        ? "warning"
        : "pass",
    message:
      sessionScan.invalidSessions.length > 0
        ? `Found ${sessionScan.invalidSessions.length} invalid task session file(s).`
        : failedSessions.length > 0
          ? `Found ${failedSessions.length} recent failed or blocked task session(s).`
          : "Stored task sessions look healthy.",
    metadata: {
      invalidSessions: sessionScan.invalidSessions.length,
      failedSessions: failedSessions.length,
      sessionCount: sessionScan.sessions.length
    }
  });

  const auditDir = join(aoDir, "audit");
  const auditDirExists = rootDirExists ? await checkExists(auditDir) : false;
  const recentAuditEvents = rootDirExists
    ? await listAuditEvents(context.rootDir, 5)
    : [];
  checks.push({
    name: "audit-log",
    status: auditDirExists ? "pass" : "warning",
    message: auditDirExists
      ? `Audit log directory is available with ${recentAuditEvents.length} recent event(s) sampled.`
      : "Audit log directory is not present yet. It will be created on the first auditable write.",
    metadata: {
      auditDir,
      exists: auditDirExists,
      sampledEvents: recentAuditEvents.length
    }
  });

  const scripts = await readRootScripts(context.rootDir);
  const missingScripts = ["typecheck", "lint", "test"].filter(
    (name) => !scripts[name]
  );
  checks.push({
    name: "validation-scripts",
    status: missingScripts.length > 0 ? "warning" : "pass",
    message:
      missingScripts.length > 0
        ? `Validation scripts missing: ${missingScripts.join(", ")}.`
        : "typecheck, lint, and test scripts are available.",
    metadata: {
      availableScripts: Object.keys(scripts)
    }
  });

  const cliMainPath = join(context.rootDir, "packages", "cli", "src", "main.ts");
  checks.push({
    name: "cli-entrypoint",
    status: (await checkExists(cliMainPath)) ? "pass" : "warning",
    message: (await checkExists(cliMainPath))
      ? "CLI entrypoint source is available."
      : "CLI entrypoint source was not found in the workspace.",
    metadata: {
      path: cliMainPath
    }
  });

  checks.push({
    name: "mcp-config-hint",
    status: "pass",
    message: "Use `ao mcp config` to print a generic local MCP server snippet.",
    metadata: {
      command: "ao",
      args: ["mcp", "serve"]
    }
  });

  checks.push({
    name: "retention-summary",
    status: "pass",
    message: `Retention defaults resolve to ${config.config.sessions.retentionDays} day(s) and ${config.config.sessions.maxStoredSessions} stored session(s).`,
    metadata: config.config.sessions
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
