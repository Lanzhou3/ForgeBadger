/**
 * dsh copilot tool surface manifest — the canonical name/description/risk list
 * of the tools the dsh runtime registers via the forgebadger-bridge Cordis
 * plugin (`packages/dsh-bridge/src/plugin.ts`). The Gateway cannot import the
 * plugin package, so this mirror exists for `GET /api/v1/copilot/capabilities`
 * to report the true tool surface when the dsh path is active; both sides pin
 * the same 15 names in their tests.
 *
 * The gateway-spawned runtime always runs with FORGEBADGER_BRIDGE_ENABLE_OPERATE=1,
 * so the operate tools are present (each gated behind the M3 approval bridge).
 */

export interface DshToolSurfaceEntry {
  name: string;
  description: string;
  risk: "read" | "operate";
  requiresApproval: boolean;
}

/** Mirror of dsh-bridge plugin.ts createBridgeTools (keep in sync). */
export function dshToolSurface(): DshToolSurfaceEntry[] {
  return [
    { name: "list_skills", description: "List available Copilot skills (name + one-line summary). Skills are playbooks teaching how to combine action tools for complete engineering workflows.", risk: "read", requiresApproval: false },
    { name: "load_skill", description: "Load the full playbook body of one skill by name: step-by-step guidance, exact tool names/parameters, error codes, and recovery rules.", risk: "read", requiresApproval: false },
    { name: "list_projects", description: "List the user's projects with name, path, status, and AI tool.", risk: "read", requiresApproval: false },
    { name: "get_project", description: "Get a single project by id with full detail.", risk: "read", requiresApproval: false },
    { name: "create_project", description: "Create a new ForgeBadger project (approval required).", risk: "operate", requiresApproval: true },
    { name: "list_sessions", description: "List the user's AI CLI sessions with status, adapter, and project.", risk: "read", requiresApproval: false },
    { name: "dispatch_task_to_session", description: "Dispatch a task to an ForgeBadger session: the message is delivered to the session's terminal as its next instruction (approval required).", risk: "operate", requiresApproval: true },
    { name: "list_work_items", description: "List ForgeBadger project development work items (portfolio tasks).", risk: "read", requiresApproval: false },
    { name: "get_work_item", description: "Get a portfolio work item by id.", risk: "read", requiresApproval: false },
    { name: "advance_work_item", description: "Advance one ForgeBadger work item automatically by ONE lifecycle step (approval required).", risk: "operate", requiresApproval: true },
    { name: "portfolio_overview", description: "Get portfolio overview: enrolled projects, open work items, and recent activity.", risk: "read", requiresApproval: false },
    { name: "list_portfolio_requests", description: "List portfolio requests, optionally filtered by project.", risk: "read", requiresApproval: false },
    { name: "get_project_dossier", description: "Get a project's portfolio dossier (objective, intended outcome, current evidence).", risk: "read", requiresApproval: false },
    { name: "search_memory", description: "Search Copilot's scoped memory (global, project, or session) by keyword.", risk: "read", requiresApproval: false },
    { name: "list_memory", description: "List Copilot's memory entries in a scope.", risk: "read", requiresApproval: false },
    { name: "write_memory", description: "Record a durable memory entry (fact, preference, decision, or project note; approval required).", risk: "operate", requiresApproval: true },
    { name: "get_usage_summary", description: "Get usage statistics: session duration and estimated cost by adapter/project/model (all time), plus token consumption totals and top buckets. Optional 'days' limits the token statistics to the last N days.", risk: "read", requiresApproval: false },
    { name: "get_session_output", description: "Read the tail of a session's buffered terminal output (last CLI screen lines). Use it to inspect progress or completion of a dispatched task. Requires the session to be live in this Gateway process.", risk: "read", requiresApproval: false },
    { name: "pm_list_task_packets", description: "List the Project Manager task packets for a project — the development queue with per-item prompt, acceptance criteria, verification expectations, linked session, and queue status.", risk: "read", requiresApproval: false },
    { name: "pm_get_task_packet", description: "Get one Project Manager task packet by work item id: full prompt, acceptance criteria, expected verification, evidence requirements, runtime adapter, and linked-session status.", risk: "read", requiresApproval: false },
    { name: "pm_start_task_packet", description: "Start executing a development work item autonomously: ensure a linked CLI session exists, launch its runtime, bind the task packet context, and deliver the packet prompt. Idempotent when already live (re-dispatches). Approval required.", risk: "operate", requiresApproval: true },
    { name: "project_graph_search", description: "Search code symbols in one project's CodeGraph index by name (functions, classes, interfaces, routes). Returns symbol ids usable with project_graph_symbol_detail / project_graph_impact. Unavailable when the project has no index (codegraph init not run).", risk: "read", requiresApproval: false },
    { name: "project_graph_symbol_detail", description: "Get one code symbol's definition (file + line) plus its direct callers and callees from the project's CodeGraph index.", risk: "read", requiresApproval: false },
    { name: "project_graph_impact", description: "Compute the blast radius of changing one code symbol: the reverse call/reference closure up to depth hops, with affected file paths and lines.", risk: "read", requiresApproval: false },
    { name: "project_graph_affected_paths", description: "Compute which code symbols are affected by changes to given files (project-relative paths, e.g. from git status): multi-file reverse blast radius with per-symbol depth.", risk: "read", requiresApproval: false },
  ];
}
