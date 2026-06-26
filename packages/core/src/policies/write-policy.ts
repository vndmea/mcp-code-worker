import {
  evaluateFileWritePath,
  type FileWriteEvaluation
} from "./path-safety.js";

export interface WritePolicyOptions {
  additionalRootDirs: string[];
  allowWrite: boolean;
  dryRun: boolean;
  rootDir: string;
}

export type WriteEvaluation = FileWriteEvaluation;

export class WritePolicy {
  public readonly allowWrite: boolean;

  public readonly additionalRootDirs: string[];

  public readonly dryRun: boolean;

  public readonly rootDir: string;

  public constructor(options: Partial<WritePolicyOptions> = {}) {
    this.allowWrite = options.allowWrite ?? false;
    this.additionalRootDirs = options.additionalRootDirs ?? [];
    this.dryRun = options.dryRun ?? true;
    this.rootDir = options.rootDir ?? process.cwd();
  }

  public evaluate(path: string, explicitAllowWrite = false): WriteEvaluation {
    return evaluateFileWritePath(path, {
      allowWrite: this.allowWrite,
      additionalRootDirs: this.additionalRootDirs,
      dryRun: this.dryRun,
      explicitAllowWrite,
      rootDir: this.rootDir
    });
  }
}
