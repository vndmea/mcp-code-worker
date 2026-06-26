export interface McpToolCatalogEntry {
  description: string;
  name: string;
}

export const mcpToolCatalog: McpToolCatalogEntry[] = [
  {
    name: "ao_plan",
    description: "Create a structured plan, worker assignment proposal, and validation strategy."
  },
  {
    name: "ao_run_workflow",
    description: "Run one of the built-in orchestration workflows and return structured results."
  },
  {
    name: "ao_run_leader_worker",
    description: "Run the leader-worker workflow with optional worker profile requirements."
  },
  {
    name: "ao_propose_patch",
    description: "Generate a structured patch proposal and inspect it without applying changes."
  },
  {
    name: "ao_inspect_patch",
    description: "Inspect a structured patch proposal for safety and applicability."
  },
  {
    name: "ao_apply_patch",
    description: "Apply a structured patch proposal with dry-run default and explicit confirmation gates."
  },
  {
    name: "ao_review_repository",
    description: "Review repository context for a scope and return structured findings."
  },
  {
    name: "ao_review_diff",
    description: "Review a diff and return structured review findings."
  },
  {
    name: "ao_review_files",
    description: "Review selected repository files and return structured findings."
  },
  {
    name: "ao_validate_repository",
    description: "Run deterministic repository validation checks with dry-run by default."
  },
  {
    name: "ao_fix_error",
    description: "Analyze an error log and propose a structured fix plan."
  },
  {
    name: "ao_start_task",
    description: "Recommended high-level coding task entrypoint that starts a local task session, persists reviewable artifacts, and returns next recommended actions."
  },
  {
    name: "ao_resume_task",
    description: "Resume a stored local task session, skipping successful steps unless told otherwise, and return updated next recommended actions."
  },
  {
    name: "ao_get_task_status",
    description: "Get the current persisted state for one local task session."
  },
  {
    name: "ao_list_tasks",
    description: "List stored local task sessions in reverse chronological order."
  },
  {
    name: "ao_get_task_report",
    description: "Render a readable markdown report for one local task session."
  },
  {
    name: "ao_read_task_artifact",
    description: "Read one persisted task artifact for a local task session."
  },
  {
    name: "ao_list_models",
    description: "List resolved leader and worker model configurations."
  },
  {
    name: "ao_list_workflows",
    description: "List built-in orchestration workflows."
  },
  {
    name: "ao_list_tools",
    description: "List MCP tool definitions exposed by the server."
  },
  {
    name: "ao_list_audit_events",
    description: "List local audit events in reverse chronological order."
  },
  {
    name: "ao_register_worker",
    description: "Register a worker model in the local worker registry."
  },
  {
    name: "ao_unregister_worker",
    description: "Remove a worker from the local worker registry."
  },
  {
    name: "ao_list_worker_registry",
    description: "List registered worker models."
  },
  {
    name: "ao_get_worker_registration",
    description: "Get one registered worker model."
  },
  {
    name: "ao_interview_worker",
    description: "Evaluate a worker model, generate a capability profile, and optionally persist it."
  },
  {
    name: "ao_list_workers",
    description: "List persisted worker capability profiles."
  },
  {
    name: "ao_get_worker_profile",
    description: "Get a single worker capability profile by id."
  },
  {
    name: "ao_doctor",
    description: "Inspect resolved configuration and local workflow prerequisites."
  }
];
