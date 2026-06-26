import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

import { listAuditEvents } from "../audit/audit-log.js";
import { loadAoConfig } from "../config/ao-config.js";
import type { ExecutionContext } from "../runtime/execution-context.js";
import {
  buildWorkspaceBindingSummary,
  type WorkspaceBindingSummary
} from "../runtime/workspace-binding.js";
import { scanTaskSessions } from "../session/task-session-store.js";
import {
  resolveValidationScripts,
  type ValidationCheckName,
  type ValidationScriptResolution
} from "../validation/validation-scripts.js";

export interface DoctorCheck {
  message: string;
  metadata?: Record<string, unknown>;
  name: string;
  status: "pass" | "warning" | "fail";
  whyItMatters?: string;
}

export type DoctorStatus = "degraded" | "misconfigured" | "ready";

export interface DoctorCapability {
  available: boolean;
  name: string;
  status: DoctorStatus;
  summary: string;
}

export interface DoctorReport {
  activeRootDir: string;
  capabilities: DoctorCapability[];
  checks: DoctorCheck[];
  minimalSuccessPath: string[];
  ok: boolean;
  recommendedActions: string[];
  recommendedEntrypoints: Array<{
    command: string;
    description: string;
    toolName?: string;
  }>;
  status: DoctorStatus;
  summary: string;
  workspaceBinding: WorkspaceBindingSummary;
}

export interface RunDoctorOptions {
  additionalChecks?: DoctorCheck[];
}

const WHY_THIS_MATTERS: Record<string, string> = {
  "root-dir":
    "If the active root directory is wrong, ao can inspect or persist work against the wrong repository.",
  "leader-model":
    "The leader model coordinates higher-level task planning and review.",
  "worker-model":
    "The worker model handles scoped execution steps such as review, validation guidance, and patch generation.",
  "ao-dir":
    "The .ao directory stores local runs, audit logs, and task artifacts that make sessions resumable.",
  "execution-mode":
    "Repository writes and session writes are separate concerns; this check explains the repository-side default only.",
  "allowed-commands":
    "These are the only shell commands ao can run through its safe command layer.",
  "ao-config":
    "Local configuration controls safety defaults, model resolution, validation mappings, and session retention.",
  "leader-api-key":
    "Without a leader credential for non-mock providers, model-backed planning and review can degrade or fail.",
  "worker-api-key":
    "Without a worker credential for non-mock providers, worker-routed tasks can degrade or fail.",
  "env-file":
    "This is one common place to load local secrets and overrides, but it is optional if configuration comes from elsewhere.",
  "runs-dir":
    "Persisted task sessions live here. If it is unavailable, reports may be temporary and not resumable.",
  "task-sessions":
    "Broken or failed sessions can make follow-up resume and artifact reads unreliable.",
  "audit-log":
    "Audit logs help explain what ao wrote and why, especially when explicit write gates are used.",
  "validation-scripts":
    "Deterministic validation is how ao proves a result instead of just sounding confident.",
  "cli-entrypoint":
    "The CLI entrypoint is required for local command-based integrations and MCP launch snippets.",
  "mcp-config-hint":
    "This is the quickest way to connect an MCP client to the local ao server.",
  "retention-summary":
    "Retention limits control how long session artifacts stay available for resume and audit.",
  "worker-profile-store":
    "Persisted worker profiles let ao reuse capability interviews instead of rediscovering routing quality every time.",
  "worker-registry":
    "The worker registry enables explicit worker routing beyond the default fallback worker.",
  "registered-worker":
    "Disabled workers stay on record but are not eligible for routing.",
  "registered-worker-profile":
    "Registered worker profiles determine whether ao can route specialized tasks confidently.",
  "default-worker-profile":
    "The default worker profile determines whether ao can route without interviewing or guessing at runtime."
};

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

const addCheck = (checks: DoctorCheck[], check: DoctorCheck): void => {
  checks.push({
    ...check,
    whyItMatters: check.whyItMatters ?? WHY_THIS_MATTERS[check.name]
  });
};

const getCheck = (
  checks: DoctorCheck[],
  name: string
): DoctorCheck | undefined => checks.find((check) => check.name === name);

const statusToDoctorStatus = (
  value: DoctorCheck["status"] | undefined
): DoctorStatus =>
  value === "fail"
    ? "misconfigured"
    : value === "warning"
      ? "degraded"
      : "ready";

const combineDoctorStatuses = (statuses: DoctorStatus[]): DoctorStatus => {
  if (statuses.includes("misconfigured")) {
    return "misconfigured";
  }

  if (statuses.includes("degraded")) {
    return "degraded";
  }

  return "ready";
};

const buildCapability = (input: {
  checks: DoctorCheck[];
  degradedSummary: string;
  failSummary: string;
  name: string;
  readySummary: string;
  relatedChecks: string[];
}): DoctorCapability => {
  const relatedStatuses = input.relatedChecks
    .map((name) => getCheck(input.checks, name)?.status)
    .filter((status): status is DoctorCheck["status"] => Boolean(status));
  const status = combineDoctorStatuses(
    relatedStatuses.map((value) => statusToDoctorStatus(value))
  );

  return {
    name: input.name,
    status,
    available: status !== "misconfigured",
    summary:
      status === "ready"
        ? input.readySummary
        : status === "degraded"
          ? input.degradedSummary
          : input.failSummary
  };
};

const buildValidationScriptMessage = (
  resolutions: Record<ValidationCheckName, ValidationScriptResolution>
): string => {
  const mappedChecks = Object.values(resolutions)
    .filter((resolution) => resolution.source === "configured")
    .map((resolution) => `${resolution.checkName}->${resolution.scriptName}`);
  const discoveredChecks = Object.values(resolutions)
    .filter((resolution) => resolution.source === "auto-discovered")
    .map((resolution) => `${resolution.checkName}->${resolution.scriptName}`);
  const missingChecks = Object.values(resolutions)
    .filter((resolution) => resolution.source === "missing")
    .map((resolution) => resolution.checkName);

  if (
    missingChecks.length === 0 &&
    mappedChecks.length === 0 &&
    discoveredChecks.length === 0
  ) {
    return "Canonical validation scripts are available.";
  }

  const parts: string[] = [];

  if (mappedChecks.length > 0) {
    parts.push(`Configured mappings: ${mappedChecks.join(", ")}.`);
  }

  if (discoveredChecks.length > 0) {
    parts.push(`Auto-discovered scripts: ${discoveredChecks.join(", ")}.`);
  }

  if (missingChecks.length > 0) {
    parts.push(`Missing checks: ${missingChecks.join(", ")}.`);
  }

  return parts.join(" ");
};

export const runDoctor = async (
  context: ExecutionContext,
  options: RunDoctorOptions = {}
): Promise<DoctorReport> => {
  const checks: DoctorCheck[] = [];
  const recommendedActions: string[] = [];
  const rootDirExists = await checkExists(context.rootDir);
  const workspaceBinding = buildWorkspaceBindingSummary(context.rootDir);

  addCheck(checks, {
    name: "root-dir",
    status: rootDirExists ? "pass" : "fail",
    message: rootDirExists
      ? workspaceBinding.matchesCallerWorkingDirectory
        ? `Resolved rootDir exists and matches the caller workspace: ${context.rootDir}`
        : `Resolved rootDir exists but is bound away from the caller workspace: ${context.rootDir}`
      : `Resolved rootDir does not exist: ${context.rootDir}`,
    metadata: {
      rootDir: context.rootDir,
      callerWorkingDirectory: workspaceBinding.callerWorkingDirectory,
      matchesCallerWorkingDirectory: workspaceBinding.matchesCallerWorkingDirectory,
      switchedFrom: workspaceBinding.switchedFrom
    }
  });

  addCheck(checks, {
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

  addCheck(checks, {
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

  addCheck(checks, {
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

  addCheck(checks, {
    name: "execution-mode",
    status: "pass",
    message:
      `Repository writes are currently ${context.dryRun || !context.allowWrite ? "dry-run only" : "enabled"} with allowWrite=${String(context.allowWrite)}. Session persistence is evaluated separately per task call.`,
    metadata: {
      allowWrite: context.allowWrite,
      dryRun: context.dryRun,
      repositoryWriteMode:
        context.dryRun || !context.allowWrite ? "dry-run" : "execute"
    }
  });

  addCheck(checks, {
    name: "allowed-commands",
    status: "pass",
    message: `Allowed commands: ${context.allowedCommands.join(", ") || "(none)"}`,
    metadata: {
      allowedCommands: context.allowedCommands
    }
  });

  const config = await loadAoConfig(context.rootDir);
  addCheck(checks, {
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
    addCheck(checks, {
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
  addCheck(checks, {
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

  addCheck(checks, {
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

  addCheck(checks, {
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
  addCheck(checks, {
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
  const validationResolutions = resolveValidationScripts(
    scripts,
    config.config.validation
  );
  const missingScripts = Object.values(validationResolutions)
    .filter((resolution) => resolution.source === "missing")
    .map((resolution) => resolution.checkName);
  const discoveredScripts = Object.values(validationResolutions)
    .filter((resolution) => resolution.source === "auto-discovered")
    .map((resolution) => resolution.scriptName)
    .filter((value): value is string => Boolean(value));
  const configuredScripts = Object.values(validationResolutions)
    .filter((resolution) => resolution.source === "configured")
    .map((resolution) => resolution.scriptName)
    .filter((value): value is string => Boolean(value));

  addCheck(checks, {
    name: "validation-scripts",
    status: missingScripts.length > 0 ? "warning" : "pass",
    message: buildValidationScriptMessage(validationResolutions),
    metadata: {
      availableScripts: Object.keys(scripts),
      configuredScripts,
      discoveredScripts,
      missingChecks: missingScripts,
      validationConfig: config.config.validation
    }
  });

  const cliMainPath = join(context.rootDir, "packages", "cli", "src", "main.ts");
  const cliMainExists = await checkExists(cliMainPath);
  addCheck(checks, {
    name: "cli-entrypoint",
    status: cliMainExists ? "pass" : "warning",
    message: cliMainExists
      ? "CLI entrypoint source is available."
      : "CLI entrypoint source was not found in the workspace.",
    metadata: {
      path: cliMainPath
    }
  });

  addCheck(checks, {
    name: "mcp-config-hint",
    status: "pass",
    message: "Use `ao mcp config` to print a generic local MCP server snippet.",
    metadata: {
      command: "ao",
      args: ["mcp", "serve"]
    }
  });

  addCheck(checks, {
    name: "retention-summary",
    status: "pass",
    message: `Retention defaults resolve to ${config.config.sessions.retentionDays} day(s) and ${config.config.sessions.maxStoredSessions} stored session(s).`,
    metadata: config.config.sessions
  });

  options.additionalChecks?.forEach((check) => {
    addCheck(checks, check);
  });

  checks.forEach((check) => {
    if (check.status === "fail" || check.status === "warning") {
      recommendedActions.push(
        `${check.status === "fail" ? "Fix" : "Review"} ${check.name}: ${check.message}`
      );
    }
  });

  const capabilities: DoctorCapability[] = [
    buildCapability({
      checks,
      name: "task-entrypoint",
      relatedChecks: [
        "root-dir",
        "leader-model",
        "worker-model",
        "ao-config",
        "leader-api-key",
        "worker-api-key"
      ],
      readySummary: "You can start model-backed ao tasks from this workspace.",
      degradedSummary:
        "You can start tasks, but some model or workspace prerequisites are only partially configured.",
      failSummary:
        "Task entrypoints are not reliable yet because core workspace or model prerequisites are misconfigured."
    }),
    buildCapability({
      checks,
      name: "session-persistence",
      relatedChecks: ["root-dir", "ao-dir", "runs-dir", "audit-log"],
      readySummary:
        "Persisted task sessions, reports, and audit artifacts are available.",
      degradedSummary:
        "ao can run, but session persistence or audit storage is only partially ready.",
      failSummary:
        "ao cannot reliably persist resumable sessions or artifacts in this workspace."
    }),
    buildCapability({
      checks,
      name: "deterministic-validation",
      relatedChecks: ["validation-scripts"],
      readySummary:
        "Deterministic validation scripts are available without extra mapping.",
      degradedSummary:
        "Validation is only partially ready. Some checks are mapped or missing.",
      failSummary:
        "Validation is not configured well enough to support deterministic task checks."
    }),
    buildCapability({
      checks,
      name: "worker-routing",
      relatedChecks: [
        "worker-profile-store",
        "worker-registry",
        "registered-worker-profile",
        "default-worker-profile"
      ],
      readySummary:
        "Explicit worker routing and persisted capability profiles are ready.",
      degradedSummary:
        "ao can still run with fallback routing, but worker registry or profile coverage is incomplete.",
      failSummary:
        "Worker routing metadata is misconfigured and should be repaired before relying on explicit worker selection."
    })
  ];

  const status = combineDoctorStatuses(
    capabilities.map((capability) => capability.status)
  );
  const degradedCapabilities = capabilities.filter(
    (capability) => capability.status === "degraded"
  );
  const misconfiguredCapabilities = capabilities.filter(
    (capability) => capability.status === "misconfigured"
  );
  const summary =
    status === "ready"
      ? `ready: ao is bound to ${context.rootDir} and core task workflows are available.`
      : status === "degraded"
        ? `degraded: ao is bound to ${context.rootDir}; ${degradedCapabilities.map((capability) => capability.name).join(", ") || "some subsystems"} need attention before the experience is smooth.`
        : `misconfigured: ao is bound to ${context.rootDir}, but ${misconfiguredCapabilities.map((capability) => capability.name).join(", ") || "core prerequisites"} are blocking reliable use.`;

  return {
    activeRootDir: context.rootDir,
    capabilities,
    ok: checks.every((check) => check.status !== "fail"),
    checks,
    minimalSuccessPath: [
      `1. Confirm the active root directory is ${context.rootDir}.`,
      "2. Verify the leader and worker model credentials or local client.",
      "3. Start a dry-run task with `ao task start --goal \"Review this repository\"`.",
      "4. Read the returned report summary or `ao task report <task-id>` if the session is persisted.",
      "5. Decide whether to continue into patch proposal and patch inspection."
    ],
    recommendedActions,
    recommendedEntrypoints: [
      {
        command: "ao task start --goal \"Review this repository\"",
        description:
          "Recommended CLI entrypoint for a dry-run task with reviewable output.",
        toolName: "ao_start_task"
      },
      {
        command: "ao task resume <task-id>",
        description: "Resume a persisted task session when you want the next step.",
        toolName: "ao_resume_task"
      },
      {
        command: "ao task report <task-id>",
        description: "Read the persisted markdown report for a task session.",
        toolName: "ao_get_task_report"
      }
    ],
    status,
    summary,
    workspaceBinding
  };
};
