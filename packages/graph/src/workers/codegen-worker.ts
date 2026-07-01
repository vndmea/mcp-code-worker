import type { ExecutionContext } from "@mcp-code-worker/core";

import {
  buildWorkerTaskContractResultOptions,
  getWorkerTaskContract
} from "../contracts/worker-task-contract.js";
import { WorkerAgent, type WorkerExecutionInput } from "./worker-agent.js";

const contract = getWorkerTaskContract("codegen");

export class CodegenWorker extends WorkerAgent {
  public constructor(context: ExecutionContext) {
    super(context, contract.capability);
  }

  public async execute(input: WorkerExecutionInput) {
    return this.createResult({
      ...buildWorkerTaskContractResultOptions(contract, input),
      task: input.task,
      allowUnqualifiedExecution: input.allowUnqualifiedExecution,
      workerProfile: input.workerProfile
    });
  }
}
