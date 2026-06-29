import { access, mkdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

import type { WorkerAvailabilitySnapshot } from "../schemas/worker-availability.schema.js";
import { listAuditEvents } from "../audit/audit-log.js";
import { loadCwConfig } from "../config/cw-config.js";
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
import {
  getCwHomeDir,
  getCwWorkspaceAuditDirFromStorageDir,
  getCwWorkspaceId,
  getCwWorkspaceRunsDirFromStorageDir
} from "../storage/cw-paths.js";

export interface DoctorCheck {
  message: string;
  metadata?: Record<string, unknown>;
  name: string;
  status: "pass" | "warning" | "fail";
  whyItMatters?: string;
}

export type DoctorStatus = "ready" | "unavailable";

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
  workerAvailability?: WorkerAvailabilitySnapshot;
  workspaceBinding: WorkspaceBindingSummary;
}

export interface RunDoctorOptions {
  additionalChecks?: DoctorCheck[];
}

const WHY_THIS_MATTERS: Record<string, string> = {
  "root-dir":
    "If the active root directory is wrong, cw can inspect or persist work against the wrong repository.",
  "runtime-bootstrap":
    "These resolved paths and bootstrap sources explain which repository, config file, and user-scoped storage cw is actually using right now.",
  "worker-model":
    "The worker model handles scoped execution steps such as review, validation guidance, and patch generation.",
  "local-client-command":
    "When cw uses a local client provider, this command is the bridge to the real model backend.",
  "local-client-compatibility":
    "A discovered executable still needs to look like the compatible local client bridge that cw expects.",
  "cw-dir":
    "The user-scoped cw workspace directory stores local runs, audit logs, configuration, and task artifacts outside the repository.",
  "execution-mode":
    "Repository writes and session writes are separate concerns; this check explains the repository-side default only.",
  "allowed-commands":
    "These are the only shell commands cw can run through its safe command layer.",
  "cw-config":
    "Local configuration controls safety defaults, model resolution, validation mappings, and session retention.",
  "worker-api-key":
    "Without a worker credential for non-mock providers, worker-routed tasks can degrade or fail.",
  "runs-dir":
    "Persisted task sessions live here. If it is unavailable, reports may be temporary and not resumable.",
  "task-sessions":
    "Broken or failed sessions can make follow-up resume and artifact reads unreliable.",
  "audit-log":
    "Audit logs help explain what cw wrote and why, especially when explicit write gates are used.",
  "validation-scripts":
    "Deterministic validation is how cw proves a result instead of just sounding confident.",
  "worker-profile-store":
    "Persisted worker profiles let cw reuse capability interviews instead of rediscovering routing quality every time.",
  "worker-registry":
    "The worker registry stores the named workers that formal task execution and readiness checks can target explicitly.",
  "registered-worker":
    "Disabled workers stay on record but are not eligible for routing.",
  "registered-worker-profile":
    "Registered worker profiles determine whether cw can route specialized tasks confidently.",
  "worker-connectivity":
    "A real connectivity probe confirms the resolved worker can answer with the current runtime wiring."
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

const canCreateDirectory = async (path: string): Promise<boolean> => {
  try {
    await mkdir(path, { recursive: true });
    return true;
  } catch {
    return false;
  }
};

const hasEnvValue = (value: string | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

const LOCAL_CLIENT_PROVIDERS = new Set(["client"]);

const resolveLocalClientCommand = (
  context: ExecutionContext
): string => context.workerModel.clientCommand?.trim() || "opencode";

const hasPathSeparator = (value: string): boolean =>
  value.includes("/") || value.includes("\\");

const hasWindowsDrivePrefix = (value: string): boolean =>
  /^[a-z]:/iu.test(value);

const buildCommandCandidates = (
  command: string,
  env: NodeJS.ProcessEnv
): string[] => {
  const isWindows = process.platform === "win32";
  const pathExt = isWindows
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .map((ext) => ext.trim())
        .filter((ext) => ext.length > 0)
    : [];
  const hasExplicitExtension = /\.[^./\\]+$/u.test(command);
  const suffixes = hasExplicitExtension || !isWindows ? [""] : ["", ...pathExt];
  const bases =
    isAbsolute(command) || hasWindowsDrivePrefix(command) || hasPathSeparator(command)
      ? [command]
      : (env.PATH ?? "")
          .split(delimiter)
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
          .map((entry) => join(entry, command));

  const candidates: string[] = [];

  for (const base of bases) {
    for (const suffix of suffixes) {
      candidates.push(`${base}${suffix}`);
    }
  }

  return Array.from(new Set(candidates));
};

const resolveCommandOnPath = async (
  command: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<string | null> => {
  const accessMode = process.platform === "win32"
    ? constants.F_OK
    : constants.X_OK;

  for (const candidate of buildCommandCandidates(command, env)) {
    try {
      await access(candidate, accessMode);
      return candidate;
    } catch {
      // Keep scanning candidates.
    }
  }

  return null;
};

const summarizeRootSource = (
  workspaceBinding: WorkspaceBindingSummary
): "cwd" | "workspace-switch" =>
  workspaceBinding.matchesCallerWorkingDirectory
    ? "cwd"
    : "workspace-switch";

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
  value === "pass" ? "ready" : "unavailable";

const combineDoctorStatuses = (statuses: DoctorStatus[]): DoctorStatus => {
  return statuses.includes("unavailable") ? "unavailable" : "ready";
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
  const hasFailure = relatedStatuses.includes("fail");

  return {
    name: input.name,
    status,
    available: !hasFailure,
    summary:
      status === "ready"
        ? input.readySummary
        : hasFailure
          ? input.failSummary
          : input.degradedSummary
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
  const rootSource = summarizeRootSource(workspaceBinding);
  const cwHomeDir = getCwHomeDir();
  const workspaceId = getCwWorkspaceId(context.rootDir);

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
      rootSource,
      callerWorkingDirectory: workspaceBinding.callerWorkingDirectory,
      matchesCallerWorkingDirectory: workspaceBinding.matchesCallerWorkingDirectory,
      switchedFrom: workspaceBinding.switchedFrom
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
      apiKeyConfigured: Boolean(context.workerModel.apiKey),
      baseURL: context.workerModel.baseURL,
      clientCommand: context.workerModel.clientCommand,
      model: context.workerModel.model,
      provider: context.workerModel.provider
    }
  });

  if (LOCAL_CLIENT_PROVIDERS.has(context.workerModel.provider)) {
    const localClientCommand = resolveLocalClientCommand(context);
    const localClientPath = await resolveCommandOnPath(localClientCommand);

    addCheck(checks, {
      name: "local-client-command",
      status: localClientPath ? "pass" : "fail",
      message: localClientPath
        ? `Local client command '${localClientCommand}' is available.`
        : `Local client command '${localClientCommand}' was not found on PATH.`,
      metadata: {
        command: localClientCommand,
        resolvedPath: localClientPath,
        configuredInConfig: Boolean(context.workerModel.clientCommand?.trim())
      }
    });
  }

  const cwDir = context.cwStorageDir;
  const cwDirExists = await checkExists(cwDir);
  const cwDirWritable = cwDirExists
    ? await canWrite(cwDir)
    : await canCreateDirectory(cwDir);

  addCheck(checks, {
    name: "cw-dir",
    status: cwDirWritable ? "pass" : "fail",
    message: cwDirExists
      ? cwDirWritable
        ? "User-scoped cw workspace directory is writable."
        : "User-scoped cw workspace directory exists but is not writable."
      : cwDirWritable
        ? "User-scoped cw workspace directory does not exist yet, but it can be created."
        : "User-scoped cw workspace directory does not exist and its parent is not writable.",
    metadata: {
      cwDir,
      exists: cwDirExists
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

  const config = await loadCwConfig(context.rootDir);
  addCheck(checks, {
    name: "runtime-bootstrap",
    status: rootDirExists ? "pass" : "warning",
    message:
      `Resolved config=${config.path}; storage=${context.cwStorageDir}; cwHome=${cwHomeDir}; workspaceId=${workspaceId}; rootSource=${rootSource}.`,
    metadata: {
      callerWorkingDirectory: workspaceBinding.callerWorkingDirectory,
      configPath: config.path,
      cwHomeDir,
      cwStorageDir: context.cwStorageDir,
      rootDir: context.rootDir,
      rootSource,
      workspaceId
    }
  });
  addCheck(checks, {
    name: "cw-config",
    status: config.error ? "fail" : config.exists ? "pass" : "warning",
      message: config.error
        ? `cw workspace config is invalid: ${config.error}`
        : config.exists
          ? "cw workspace config is present and readable."
          : "cw workspace config is missing. Built-in defaults are active until config.json is written.",
      metadata: {
        path: config.path
      }
    });

  const apiKeyChecks = [
    {
      name: "worker-api-key",
      provider: context.workerModel.provider,
      hasKey: Boolean(context.workerModel.apiKey),
      source: config.config.workerModel?.apiKey ? "config.json" : undefined
    }
  ];

  apiKeyChecks.forEach((entry) => {
    const isLocalClientProvider = LOCAL_CLIENT_PROVIDERS.has(entry.provider);

    addCheck(checks, {
      name: entry.name,
      status:
        entry.provider === "mock"
          ? "pass"
          : isLocalClientProvider
          ? "pass"
          : entry.hasKey
            ? "pass"
            : "warning",
      message:
        entry.provider === "mock"
          ? `${entry.name} is using a mock provider and does not require a key.`
          : isLocalClientProvider
            ? `${entry.name} is using a local client provider and does not require an API key.`
          : entry.hasKey
            ? `${entry.name} resolved successfully from ${entry.source ?? "runtime config"}.`
            : `${entry.name} is not set. Expected workerModel.apiKey in config.json for provider ${entry.provider}.`,
      metadata: {
        provider: entry.provider,
        source: entry.source
      }
    });
  });

  const runsDir = getCwWorkspaceRunsDirFromStorageDir(context.cwStorageDir);
  const runsDirExists = await checkExists(runsDir);
  const sessionScan = await scanTaskSessions(
    context.rootDir,
    context.cwStorageDir
  );
  const failedSessions = sessionScan.sessions.filter(
    (session) => session.status === "failed"
  );

  addCheck(checks, {
    name: "runs-dir",
    status: runsDirExists ? "pass" : "warning",
    message: runsDirExists
      ? `cw session storage is present with ${sessionScan.sessions.length} valid session(s).`
      : "cw session storage is not present yet. It can be created when task sessions are persisted.",
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
          ? `Found ${failedSessions.length} recent failed task session(s).`
          : "Stored task sessions look healthy.",
    metadata: {
      invalidSessions: sessionScan.invalidSessions.length,
      failedSessions: failedSessions.length,
      sessionCount: sessionScan.sessions.length
    }
  });

  const auditDir = getCwWorkspaceAuditDirFromStorageDir(context.cwStorageDir);
  const auditDirExists = await checkExists(auditDir);
  const recentAuditEvents = await listAuditEvents(
    context.rootDir,
    5,
    context.cwStorageDir
  );
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
        "worker-model",
        "local-client-command",
        "local-client-compatibility",
        "cw-config",
        "worker-api-key",
        "worker-connectivity"
      ],
      readySummary: "You can start model-backed cw tasks from this workspace.",
      degradedSummary:
        "You can start tasks, but some model or workspace prerequisites are only partially configured.",
      failSummary:
        "Task entrypoints are not reliable yet because core workspace or model prerequisites are misconfigured."
    }),
    buildCapability({
      checks,
      name: "session-persistence",
      relatedChecks: ["root-dir", "cw-dir", "runs-dir", "audit-log"],
      readySummary:
        "Persisted task sessions, reports, and audit artifacts are available.",
      degradedSummary:
        "cw can run, but session persistence or audit storage is only partially ready.",
      failSummary:
        "cw cannot reliably persist resumable sessions or artifacts in this workspace."
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
        "registered-worker-profile"
      ],
      readySummary:
        "Explicit worker routing and persisted capability profiles are ready.",
      degradedSummary:
        "Named worker routing metadata is only partially ready. Review the registry and persisted profiles before relying on formal worker selection.",
      failSummary:
        "Worker routing metadata is misconfigured and should be repaired before relying on explicit worker selection."
    })
  ];

  const status = combineDoctorStatuses(
    capabilities.map((capability) => capability.status)
  );
  const unavailableCapabilities = capabilities.filter(
    (capability) => capability.status === "unavailable"
  );
  const summary =
    status === "ready"
      ? `ready: cw is bound to ${context.rootDir} and core task workflows are available.`
      : `unavailable: cw is bound to ${context.rootDir}, but ${unavailableCapabilities.map((capability) => capability.name).join(", ") || "core prerequisites"} still need attention before the workflow is reliable.`;

  return {
    activeRootDir: context.rootDir,
    capabilities,
    ok: status === "ready",
    checks,
    minimalSuccessPath: [
      `1. Confirm the active root directory is ${context.rootDir}.`,
      "2. Verify the worker model credential or local client.",
      "3. Use `cw doctor --probe` when you want a live connectivity probe.",
      "4. Start a dry-run task with `cw task start --worker <id> --goal \"Review this repository\"`.",
      "5. Read the returned report summary or `cw task report <task-id>` if the session is persisted.",
      "6. Decide whether to continue into patch proposal and patch inspection."
    ],
    recommendedActions,
    recommendedEntrypoints: [
      {
        command: "cw task start --worker <id> --goal \"Review this repository\"",
        description:
          "Recommended CLI entrypoint for a dry-run task with reviewable output.",
        toolName: "cw_start_task"
      },
      {
        command: "cw task resume <task-id>",
        description: "Resume a persisted task session when you want the next step.",
        toolName: "cw_resume_task"
      },
      {
        command: "cw task report <task-id>",
        description: "Read the persisted markdown report for a task session.",
        toolName: "cw_get_task_report"
      }
    ],
    status,
    summary,
    workspaceBinding
  };
};
