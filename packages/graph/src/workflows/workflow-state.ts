import type { AgentTask, WorkflowState } from "@agent-orchestrator/core";

export const createInitialWorkflowState = (
  task: AgentTask
): WorkflowState => ({
  task,
  plan: null,
  workerResults: [],
  toolResults: [],
  review: null,
  finalResult: null,
  workerCapabilityProfile: null,
  warnings: [],
  errors: []
});
