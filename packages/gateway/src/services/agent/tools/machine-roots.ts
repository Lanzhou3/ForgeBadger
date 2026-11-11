import { executeAgentAction } from "../../platform-commands/agent-actions.js";
import { z } from "zod";
import { CopilotMachineRootRepository } from "../../../db/repositories/copilot-machine-root-repository.js";
import type { AgentTool } from "../tool-registry.js";

const registerInput = z.object({
  label: z.string().trim().min(1).max(200),
  /** Absolute local directory path (any OS). Validated as a real directory and root-guarded. */
  path: z.string().trim().min(1).max(1024),
}).strict();
const unregisterInput = z.object({ rootId: z.string().min(1).max(128) }).strict();

/**
 * Read-only listing of the owner's registered local search roots. Pairs with the
 * operate register/unregister tools: this is how the model discovers which roots
 * (and their ids) it may pass to machine_search / read_machine_file.
 */
export function createMachineRootListTools(): AgentTool[] {
  return [
    {
      name: "list_machine_roots",
      description: "List the local directories this owner has registered as read-only search roots (id, label, path)." +
        " Use the returned root id as the `root` argument to machine_search and read_machine_file.",
      risk: "read",
      requiresApproval: false,
      inputSchema: z.object({}).strict(),
      async execute(_input, context) {
        const roots = new CopilotMachineRootRepository(context.db, context.userId).list()
          .map(({ id, label, path }) => ({ id, label, path }));
        return { roots, count: roots.length };
      }
    }
  ];
}

/**
 * Owner-granted local roots for the read-only `machine_search` tool. Registering
 * or revoking a root is an operate-class action, so both are approval-gated and
 * audited like every other platform write.
 */
export function createMachineRootTools(): AgentTool[] {
  return [
    {
      name: "register_machine_root",
      description: "Register an existing local directory as a read-only search root so machine_search can traverse it. Owner-approved.",
      risk: "operate",
      requiresApproval: true,
      riskClass: "medium",
      inputSchema: registerInput,
      async execute(input, context) {
        return executeAgentAction("register_machine_root", registerInput.parse(input), context);
      }
    },
    {
      name: "unregister_machine_root",
      description: "Revoke a previously registered local search root. Owner-approved.",
      risk: "operate",
      requiresApproval: true,
      riskClass: "medium",
      inputSchema: unregisterInput,
      async execute(input, context) {
        return executeAgentAction("unregister_machine_root", unregisterInput.parse(input), context);
      }
    }
  ];
}
