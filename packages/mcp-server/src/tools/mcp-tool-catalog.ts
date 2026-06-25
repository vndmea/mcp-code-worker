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
    name: "ao_review_diff",
    description: "Review a diff and return structured review findings."
  },
  {
    name: "ao_fix_error",
    description: "Analyze an error log and propose a structured fix plan."
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
