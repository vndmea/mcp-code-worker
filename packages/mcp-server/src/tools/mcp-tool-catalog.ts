export type McpToolCategory =
  | "diagnostics"
  | "high-level-task-entrypoints"
  | "management"
  | "workflow-building-blocks";

export interface McpToolCatalogEntry {
  category: McpToolCategory;
  description: string;
  name: string;
  recommended?: boolean;
}

export interface McpToolCatalogView {
  groups: Array<{
    category: McpToolCategory;
    tools: McpToolCatalogEntry[];
  }>;
  recommendedEntrypoints: McpToolCatalogEntry[];
  summary: string;
}

export const mcpToolCatalog: McpToolCatalogEntry[] = [
  {
    name: "ao_run_host_worker",
    category: "workflow-building-blocks",
    description: "Run one explicit worker task under host control with debug evidence and without introducing a second leader surface."
  },
  {
    name: "ao_propose_patch",
    category: "workflow-building-blocks",
    description: "Generate a structured patch proposal and inspect it without applying changes."
  },
  {
    name: "ao_inspect_patch",
    category: "workflow-building-blocks",
    description: "Inspect a structured patch proposal for safety and applicability."
  },
  {
    name: "ao_apply_patch",
    category: "workflow-building-blocks",
    description: "Apply a structured patch proposal with dry-run default and explicit confirmation gates."
  },
  {
    name: "ao_review_repository",
    category: "workflow-building-blocks",
    description: "Review repository context for a scope and return structured findings."
  },
  {
    name: "ao_review_diff",
    category: "workflow-building-blocks",
    description: "Review a diff and return structured review findings."
  },
  {
    name: "ao_review_files",
    category: "workflow-building-blocks",
    description: "Review selected repository files and return structured findings."
  },
  {
    name: "ao_validate_repository",
    category: "workflow-building-blocks",
    description: "Run deterministic repository validation checks with dry-run by default."
  },
  {
    name: "ao_fix_error",
    category: "workflow-building-blocks",
    description: "Analyze an error log and propose a structured fix plan."
  },
  {
    name: "ao_start_task",
    category: "high-level-task-entrypoints",
    recommended: true,
    description: "Recommended host-facing coding entrypoint that keeps the host in control while ao manages context, validation, artifacts, and patch gates."
  },
  {
    name: "ao_resume_task",
    category: "high-level-task-entrypoints",
    recommended: true,
    description: "Resume a stored local task session, skipping successful steps unless told otherwise, and return updated next recommended actions."
  },
  {
    name: "ao_get_task_status",
    category: "high-level-task-entrypoints",
    description: "Get the current persisted state for one local task session."
  },
  {
    name: "ao_list_tasks",
    category: "high-level-task-entrypoints",
    description: "List stored local task sessions in reverse chronological order."
  },
  {
    name: "ao_get_task_report",
    category: "high-level-task-entrypoints",
    recommended: true,
    description: "Render a readable markdown report for one local task session."
  },
  {
    name: "ao_read_task_artifact",
    category: "high-level-task-entrypoints",
    description: "Read one persisted task artifact for a local task session."
  },
  {
    name: "ao_list_models",
    category: "diagnostics",
    description: "List resolved worker model configurations."
  },
  {
    name: "ao_list_workflows",
    category: "diagnostics",
    description: "List host-managed orchestration workflows that remain available through public tools."
  },
  {
    name: "ao_list_tools",
    category: "diagnostics",
    description: "List MCP tool definitions exposed by the server."
  },
  {
    name: "ao_list_audit_events",
    category: "diagnostics",
    description: "List local audit events in reverse chronological order."
  },
  {
    name: "ao_register_worker",
    category: "management",
    description: "Register a worker model in the local worker registry."
  },
  {
    name: "ao_unregister_worker",
    category: "management",
    description: "Remove a worker from the local worker registry."
  },
  {
    name: "ao_list_worker_registry",
    category: "management",
    description: "List registered worker models."
  },
  {
    name: "ao_get_worker_registration",
    category: "management",
    description: "Get one registered worker model."
  },
  {
    name: "ao_interview_worker",
    category: "management",
    description: "Evaluate a worker model, generate a capability profile, and optionally persist it."
  },
  {
    name: "ao_benchmark_worker",
    category: "management",
    description: "Run the coding benchmark suite for a worker model, optionally persist the artifact, and optionally update persisted worker capabilities."
  },
  {
    name: "ao_list_workers",
    category: "management",
    description: "List persisted worker capability profiles."
  },
  {
    name: "ao_get_worker_profile",
    category: "management",
    description: "Get a single worker capability profile by id."
  },
  {
    name: "ao_doctor",
    category: "diagnostics",
    description: "Inspect resolved configuration and local workflow prerequisites."
  }
];

const CATALOG_ORDER: McpToolCategory[] = [
  "high-level-task-entrypoints",
  "diagnostics",
  "management",
  "workflow-building-blocks"
];

export const buildMcpToolCatalogView = (): McpToolCatalogView => ({
  summary:
    "Start with ao_start_task for host-managed coding flows; use lower-level tools only when you explicitly need narrower worker or artifact control.",
  recommendedEntrypoints: mcpToolCatalog.filter((tool) => tool.recommended),
  groups: CATALOG_ORDER.map((category) => ({
    category,
    tools: mcpToolCatalog.filter((tool) => tool.category === category)
  }))
});
