import type {
  AgentResult,
  PatchInspection,
  PatchProposal,
  RepositoryContextPack,
  ValidationReport,
  WorkerResultStatus,
  WorkerTaskType
} from "@mcp-code-worker/core";

export type HostSemanticFailureStage =
  | "missing-requested-files"
  | "coverage-gap"
  | "missing-file-citations"
  | "template-fallback"
  | "generic-fallback"
  | "validation-claim-unsupported"
  | "patch-file-out-of-context"
  | "patch-inspection-blocked"
  | "patch-validation-claim-unsupported"
  | "patch-placeholder"
  | "review-answer-missing"
  | "review-findings-insufficient"
  | "review-findings-missing-file-citations"
  | "review-file-reference-missing"
  | "review-file-reference-out-of-scope";

export type HostSemanticExecutionState =
  | "blocked_by_policy"
  | "not_executed"
  | "executed";

export interface HostSemanticValidationInput {
  executionState: HostSemanticExecutionState;
  patchInspection?: PatchInspection;
  patchProposal?: PatchProposal;
  repositoryContext: RepositoryContextPack;
  requestedFiles: string[];
  taskType: WorkerTaskType;
  validationReport?: ValidationReport;
  workerResult: AgentResult | null;
}

export interface HostSemanticValidationIssue {
  reason: string;
  stage: HostSemanticFailureStage;
  status: WorkerResultStatus;
}

export interface HostSemanticValidationContext {
  coverageGapDetected: boolean;
  mentionedFiles: string[];
  missingRequestedFiles: string[];
  outputRecord: Record<string, unknown> | null;
  outputText: string;
  selectedPaths: string[];
  skippedFiles: string[];
}

export interface HostSemanticValidationResult {
  coverageGapDetected: boolean;
  genericFallbackDetected: boolean;
  issues: HostSemanticValidationIssue[];
  mentionedFiles: string[];
  missingRequestedFiles: string[];
  resultStatus: WorkerResultStatus;
  skippedFiles: string[];
  templateFallbackDetected: boolean;
}

export interface HostSemanticValidator {
  id: string;
  taskTypes?: ReadonlyArray<WorkerTaskType>;
  validate: (
    input: HostSemanticValidationInput,
    context: HostSemanticValidationContext
  ) => HostSemanticValidationIssue[];
}

const reviewTaskTypes = [
  "review-lite",
  "risk-analysis",
  "code-understanding"
] as const satisfies ReadonlyArray<WorkerTaskType>;

const isTaskTypeEnabled = (
  validator: HostSemanticValidator,
  taskType: WorkerTaskType
): boolean => !validator.taskTypes || validator.taskTypes.includes(taskType);

const isReviewTaskType = (taskType: WorkerTaskType): boolean =>
  reviewTaskTypes.some((reviewTaskType) => reviewTaskType === taskType);

const isPatchProposalTaskType = (taskType: WorkerTaskType): boolean =>
  taskType === "patch-generation";

const detectTemplateFallback = (text: string): boolean =>
  /summarize-context|draft-implementation|plan-tests|scope not provided/iu.test(
    text
  );

const detectGenericFallback = (text: string): boolean =>
  /review the files|inspect the code|depends on context|needs more context|check the implementation|candidate patch/iu.test(
    text
  );

const asOutputRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const createValidationContext = (
  input: HostSemanticValidationInput
): HostSemanticValidationContext => {
  const selectedPaths = input.repositoryContext.selectedFiles.map(
    (file) => file.path
  );
  const skippedFiles = input.repositoryContext.skippedFiles ?? [];
  const outputText = input.workerResult
    ? JSON.stringify(input.workerResult.output)
    : "";

  return {
    coverageGapDetected:
      input.repositoryContext.coverageGapDetected === true ||
      skippedFiles.length > 0,
    mentionedFiles: selectedPaths.filter((path) => outputText.includes(path)),
    missingRequestedFiles: input.requestedFiles.filter(
      (path) => !selectedPaths.includes(path)
    ),
    outputRecord: asOutputRecord(input.workerResult?.output),
    outputText,
    selectedPaths,
    skippedFiles
  };
};

const repositoryContextValidator: HostSemanticValidator = {
  id: "repository-context",
  validate: (_input, context) => {
    const issues: HostSemanticValidationIssue[] = [];

    if (context.missingRequestedFiles.length > 0) {
      issues.push({
        reason: `Requested files were not all included in repository context: ${context.missingRequestedFiles.join(", ")}.`,
        stage: "missing-requested-files",
        status: "needs_more_context"
      });
    }

    if (context.coverageGapDetected) {
      issues.push({
        reason: `Repository context skipped candidate files and may be incomplete: ${context.skippedFiles.join(", ") || "unknown skipped files"}.`,
        stage: "coverage-gap",
        status: "needs_more_context"
      });
    }

    return issues;
  }
};

const selectedFileCitationValidator: HostSemanticValidator = {
  id: "selected-file-citations",
  validate: (input, context) => {
    if (
      input.executionState !== "executed" ||
      isPatchProposalTaskType(input.taskType) ||
      context.selectedPaths.length === 0 ||
      context.mentionedFiles.length > 0
    ) {
      return [];
    }

    return [
      {
        reason: "Worker answer did not reference any selected repository file.",
        stage: "missing-file-citations",
        status: "invalid_output"
      }
    ];
  }
};

const fallbackPatternValidator: HostSemanticValidator = {
  id: "fallback-patterns",
  validate: (input, context) => {
    if (input.executionState !== "executed") {
      return [];
    }

    const issues: HostSemanticValidationIssue[] = [];

    if (detectTemplateFallback(context.outputText)) {
      issues.push({
        reason: "Worker answer matched a known template fallback pattern.",
        stage: "template-fallback",
        status: "invalid_output"
      });
    }

    if (isReviewTaskType(input.taskType) && detectGenericFallback(context.outputText)) {
      issues.push({
        reason: "Worker answer fell back to generic wording instead of a concrete repository answer.",
        stage: "generic-fallback",
        status: "invalid_output"
      });
    }

    return issues;
  }
};

const reviewOutputValidator: HostSemanticValidator = {
  id: "review-output",
  taskTypes: reviewTaskTypes,
  validate: (input, context) => {
    if (input.executionState !== "executed") {
      return [];
    }

    const answer =
      context.outputRecord && typeof context.outputRecord.answer === "string"
        ? context.outputRecord.answer
        : "";
    const findings = asStringArray(context.outputRecord?.findings);
    const referencedFiles = asStringArray(context.outputRecord?.referencedFiles);
    const findingsMissingFileCitations =
      context.selectedPaths.length > 0 &&
      findings.some(
        (finding) => !context.selectedPaths.some((path) => finding.includes(path))
      );
    const outOfScopeReferences = referencedFiles.filter(
      (file) => !context.selectedPaths.includes(file)
    );
    const issues: HostSemanticValidationIssue[] = [];

    if (!answer) {
      issues.push({
        reason: "Review worker did not provide a direct answer field.",
        stage: "review-answer-missing",
        status: "invalid_output"
      });
    }

    if (
      context.selectedPaths.length > 0 &&
      !referencedFiles.some((file) => context.selectedPaths.includes(file))
    ) {
      issues.push({
        reason: "Review worker did not reference the selected files explicitly.",
        stage: "review-file-reference-missing",
        status: "invalid_output"
      });
    }

    if (findingsMissingFileCitations) {
      issues.push({
        reason: "Review worker findings did not cite selected repository files in every finding.",
        stage: "review-findings-missing-file-citations",
        status: "invalid_output"
      });
    }

    if (context.selectedPaths.length > 0 && outOfScopeReferences.length > 0) {
      issues.push({
        reason: `Review worker referenced files outside the selected repository context: ${outOfScopeReferences.join(", ")}.`,
        stage: "review-file-reference-out-of-scope",
        status: "blocked"
      });
    }

    return issues;
  }
};

const textClaimsValidationPassed = (text: string): boolean =>
  /\b(?:test|tests|typecheck|lint|validation|checks?)\b[\s\S]{0,80}\b(?:pass(?:ed|es)?|success(?:ful)?|green|clean)\b/iu.test(
    text
  ) ||
  /\b(?:pass(?:ed|es)?|success(?:ful)?|green|clean)\b[\s\S]{0,80}\b(?:test|tests|typecheck|lint|validation|checks?)\b/iu.test(
    text
  );

const validationReportSupportsPassedClaim = (
  validationReport: ValidationReport | undefined
): boolean =>
  validationReport?.ok === true ||
  validationReport?.checks.some((check) => check.status === "success") === true;

const validationClaimValidator: HostSemanticValidator = {
  id: "validation-claims",
  validate: (input, context) => {
    if (
      input.executionState !== "executed" ||
      !textClaimsValidationPassed(context.outputText) ||
      validationReportSupportsPassedClaim(input.validationReport)
    ) {
      return [];
    }

    return [
      {
        reason:
          "Worker output claimed validation or tests passed, but the supplied validation report does not support that claim.",
        stage: "validation-claim-unsupported",
        status: "invalid_output"
      }
    ];
  }
};

const patchProposalText = (proposal: PatchProposal): string =>
  [
    proposal.title,
    proposal.summary,
    ...proposal.rationale,
    ...proposal.risks,
    ...proposal.validationPlan
  ].join("\n");

const patchProposalFilePaths = (
  proposal: PatchProposal,
  inspection: PatchInspection | undefined
): string[] => [
  ...new Set([
    ...proposal.files.map((file) => file.path),
    ...(inspection?.files.map((file) => file.path) ?? [])
  ])
];

const patchProposalValidator: HostSemanticValidator = {
  id: "patch-proposal",
  taskTypes: ["patch-generation"],
  validate: (input, context) => {
    const proposal = input.patchProposal;
    if (!proposal) {
      return [];
    }

    const issues: HostSemanticValidationIssue[] = [];
    const proposalPaths = patchProposalFilePaths(
      proposal,
      input.patchInspection
    );
    const outOfContextPatchFiles =
      context.selectedPaths.length > 0
        ? proposalPaths.filter((path) => !context.selectedPaths.includes(path))
        : [];

    if (outOfContextPatchFiles.length > 0) {
      issues.push({
        reason: `Patch proposal touched files outside the host-selected context: ${outOfContextPatchFiles.join(", ")}.`,
        stage: "patch-file-out-of-context",
        status: "blocked"
      });
    }

    if (proposal.title.includes("[PLACEHOLDER]")) {
      issues.push({
        reason:
          "Patch proposal is a non-actionable placeholder and requires host takeover or more context.",
        stage: "patch-placeholder",
        status: "blocked"
      });
    }

    if (
      textClaimsValidationPassed(patchProposalText(proposal)) &&
      !validationReportSupportsPassedClaim(input.validationReport)
    ) {
      issues.push({
        reason:
          "Patch proposal claimed validation or tests passed, but the supplied validation report does not support that claim.",
        stage: "patch-validation-claim-unsupported",
        status: "invalid_output"
      });
    }

    if (input.patchInspection && !input.patchInspection.ok) {
      issues.push({
        reason: `Patch inspection blocked the proposal: ${input.patchInspection.blockedReasons.join(" | ") || "unknown reason"}.`,
        stage: "patch-inspection-blocked",
        status: "blocked"
      });
    }

    return issues;
  }
};

const validators: HostSemanticValidator[] = [
  repositoryContextValidator,
  selectedFileCitationValidator,
  fallbackPatternValidator,
  validationClaimValidator,
  patchProposalValidator,
  reviewOutputValidator
];

export const listHostSemanticValidators = (): HostSemanticValidator[] => [
  ...validators
];

export const runHostSemanticValidation = (
  input: HostSemanticValidationInput
): HostSemanticValidationResult => {
  const context = createValidationContext(input);
  const issues = validators
    .filter((validator) => isTaskTypeEnabled(validator, input.taskType))
    .flatMap((validator) => validator.validate(input, context));

  return {
    coverageGapDetected: context.coverageGapDetected,
    genericFallbackDetected:
      input.executionState === "executed" &&
      isReviewTaskType(input.taskType) &&
      detectGenericFallback(context.outputText),
    issues,
    mentionedFiles: context.mentionedFiles,
    missingRequestedFiles: context.missingRequestedFiles,
    resultStatus: resolveSemanticResultStatus(issues),
    skippedFiles: context.skippedFiles,
    templateFallbackDetected:
      input.executionState === "executed" &&
      detectTemplateFallback(context.outputText)
  };
};

const resolveSemanticResultStatus = (
  issues: HostSemanticValidationIssue[]
): WorkerResultStatus => {
  if (issues.length === 0) {
    return "ok";
  }

  if (issues.some((issue) => issue.status === "blocked")) {
    return "blocked";
  }

  if (issues.some((issue) => issue.status === "invalid_output")) {
    return "invalid_output";
  }

  if (issues.some((issue) => issue.status === "needs_more_context")) {
    return "needs_more_context";
  }

  return "host_takeover";
};
