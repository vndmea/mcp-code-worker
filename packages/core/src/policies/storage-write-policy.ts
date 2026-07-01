export type StorageWriteDomain =
  | "audit-write"
  | "benchmark-write"
  | "config-write"
  | "execution-record-write"
  | "profile-write"
  | "secret-write"
  | "session-write";

export interface StorageWritePolicyOptions {
  allowWrite: boolean;
  dryRun: boolean;
}

export interface StorageWriteEvaluation {
  allowed: boolean;
  domain: StorageWriteDomain;
  mode: "blocked" | "dry-run" | "execute";
  reason: string;
}

const DOMAIN_REQUIRES_GENERAL_WRITE = new Set<StorageWriteDomain>([
  "secret-write"
]);

const DOMAIN_DRY_RUN_UNTIL_EXPLICIT = new Set<StorageWriteDomain>([
  "benchmark-write",
  "config-write",
  "profile-write"
]);

export class StorageWritePolicy {
  public readonly allowWrite: boolean;

  public readonly dryRun: boolean;

  public constructor(options: Partial<StorageWritePolicyOptions> = {}) {
    this.allowWrite = options.allowWrite ?? false;
    this.dryRun = options.dryRun ?? true;
  }

  public evaluate(
    domain: StorageWriteDomain,
    explicitAllowWrite = false
  ): StorageWriteEvaluation {
    const requiresGeneralWrite = DOMAIN_REQUIRES_GENERAL_WRITE.has(domain);
    const isDryRunUntilExplicit = DOMAIN_DRY_RUN_UNTIL_EXPLICIT.has(domain);

    if (requiresGeneralWrite && !explicitAllowWrite && !this.allowWrite) {
      return {
        allowed: false,
        domain,
        mode: "blocked",
        reason: `${domain} requires explicit managed-state write permission.`
      };
    }

    if (isDryRunUntilExplicit && !explicitAllowWrite) {
      return {
        allowed: true,
        domain,
        mode: "dry-run",
        reason: `${domain} is dry-run until the command explicitly enables that storage domain.`
      };
    }

    if (domain === "session-write") {
      return {
        allowed: true,
        domain,
        mode: explicitAllowWrite ? "execute" : "dry-run",
        reason: explicitAllowWrite
          ? `${domain} is allowed to persist managed state.`
          : `${domain} is dry-run until the command explicitly enables that storage domain.`
      };
    }

    if (domain === "audit-write" || domain === "execution-record-write") {
      if (this.dryRun && !explicitAllowWrite) {
        return {
          allowed: true,
          domain,
          mode: "dry-run",
          reason: `${domain} is dry-run because the execution context is in dry-run mode.`
        };
      }

      return {
        allowed: true,
        domain,
        mode: "execute",
        reason: `${domain} is allowed to persist managed state.`
      };
    }

    if (this.dryRun) {
      return {
        allowed: true,
        domain,
        mode: "dry-run",
        reason: `${domain} is dry-run because the execution context is in dry-run mode.`
      };
    }

    return {
      allowed: true,
      domain,
      mode: "execute",
      reason: `${domain} is allowed to persist managed state.`
    };
  }
}
