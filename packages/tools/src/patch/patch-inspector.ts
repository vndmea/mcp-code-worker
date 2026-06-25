import { basename } from "node:path";

import {
  PatchInspectionSchema,
  type ExecutionContext,
  type PatchFileChange,
  type PatchInspection,
  type PatchProposal,
  evaluateFileWritePath
} from "@agent-orchestrator/core";

import { parseUnifiedDiff, type ParsedPatchFile } from "./patch-parser.js";

const SECRET_FILE_PATTERNS = [
  /^\.env(?:\..+)?$/iu,
  /^id_rsa$/iu,
  /^id_ed25519$/iu,
  /\.pem$/iu,
  /\.key$/iu,
  /\.p12$/iu,
  /\.pfx$/iu
];

const DELETED_LOCKFILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb"
]);

const isBinaryLookingDiff = (diffText: string): boolean =>
  diffText.includes("GIT binary patch") ||
  /^Binary files /mu.test(diffText);

const buildSummary = (file: ParsedPatchFile): string => {
  switch (file.changeType) {
    case "add":
      return `Add ${file.path} (${file.additions} additions).`;
    case "delete":
      return `Delete ${file.path} (${file.deletions} deletions).`;
    default:
      return `Modify ${file.path} (${file.additions} additions, ${file.deletions} deletions).`;
  }
};

const inferRiskLevel = (
  file: ParsedPatchFile
): PatchFileChange["riskLevel"] => {
  const magnitude = file.additions + file.deletions;
  if (file.changeType === "delete" || magnitude > 50) {
    return "high";
  }

  if (magnitude > 10) {
    return "medium";
  }

  return "low";
};

const mergeInspectionFiles = (
  parsedFiles: ParsedPatchFile[],
  proposalFiles: PatchProposal["files"]
): PatchFileChange[] =>
  parsedFiles.map((parsedFile) => {
    const matchingProposalFile = proposalFiles.find(
      (file) => file.path === parsedFile.path
    );

    return {
      path: parsedFile.path,
      changeType: parsedFile.changeType,
      summary: matchingProposalFile?.summary ?? buildSummary(parsedFile),
      riskLevel:
        matchingProposalFile?.riskLevel ?? inferRiskLevel(parsedFile),
      beforeHash: matchingProposalFile?.beforeHash,
      afterHash: matchingProposalFile?.afterHash
    };
  });

export async function inspectPatch(
  context: ExecutionContext,
  proposal: PatchProposal
): Promise<PatchInspection> {
  await Promise.resolve();
  const blockedReasons: string[] = [];
  const warnings: string[] = [];
  const diffText = proposal.unifiedDiff.trim();

  if (!diffText) {
    blockedReasons.push("Patch diff was empty.");
  }

  if (isBinaryLookingDiff(proposal.unifiedDiff)) {
    blockedReasons.push("Binary-looking patches are blocked.");
  }

  if (!proposal.unifiedDiff.includes("diff --git ")) {
    blockedReasons.push("Unsupported diff format. Expected unified diff output.");
  }

  const parsedFiles = blockedReasons.includes(
    "Unsupported diff format. Expected unified diff output."
  )
    ? []
    : parseUnifiedDiff(proposal.unifiedDiff);

  if (parsedFiles.length === 0 && blockedReasons.length === 0) {
    blockedReasons.push("Patch did not contain any supported file changes.");
  }

  const files = mergeInspectionFiles(parsedFiles, proposal.files);

  files.forEach((file) => {
    const pathEvaluation = evaluateFileWritePath(file.path, {
      allowWrite: true,
      dryRun: false,
      explicitAllowWrite: true,
      rootDir: context.rootDir
    });
    if (!pathEvaluation.allowed || pathEvaluation.mode === "blocked") {
      blockedReasons.push(`${file.path}: ${pathEvaluation.reason}`);
    }

    if (SECRET_FILE_PATTERNS.some((pattern) => pattern.test(basename(file.path)))) {
      blockedReasons.push(`${file.path}: secret-like files cannot be patched.`);
    }

    if (
      file.changeType === "delete" &&
      DELETED_LOCKFILES.has(basename(file.path))
    ) {
      blockedReasons.push(`${file.path}: deleting lockfiles is blocked.`);
    }
  });

  if (proposal.files.length !== files.length) {
    warnings.push("Proposal metadata file list did not fully match parsed diff files.");
  }

  return PatchInspectionSchema.parse({
    ok: blockedReasons.length === 0,
    files,
    blockedReasons,
    warnings,
    stats: {
      filesChanged: parsedFiles.length,
      additions: parsedFiles.reduce((sum, file) => sum + file.additions, 0),
      deletions: parsedFiles.reduce((sum, file) => sum + file.deletions, 0)
    }
  });
}
