import type { AgentToolRegistry } from './tool-registry.js';
import type { AgentLlmToolSchema } from './orchestrator-types.js';
import type { TurnInput } from './run-ledger.js';

/**
 * Plane A of the tool surface: one named, ordered layer computation that both
 * the model-visible catalog and the execution-time gate project from. Layers
 * run retired → scheduled-readonly → restricted-mode → session-runtime →
 * mcp-source → owner-disabled → goal-catalog → on-demand; each exclusion
 * records its layer so rejection provenance (e.g. the run-trace tool_gate
 * reason) names the plane that closed the tool. The execution gate in
 * orchestrator.toolStep preserves its historical check ORDER — ordering is
 * behavior there.
 */
export const RETIRED_TOOLS = new Set(['pm_start_task_packet', 'list_skills', 'load_skill']);
/**
 * On-demand tools: surfaced only to runs that opt into tool discovery.
 * In a normal run the model-visible catalog is already complete, and a
 * permanent "search for tools" affordance was pulling runs into search loops
 * that the step budget then ended. (2026-11-11 remediation WP4.)
 */
export const ON_DEMAND_TOOLS = new Set(['discover_tools']);
/** Local paths and contents stay out of channel-originated model context. */
export const LOCAL_MACHINE_ROOT_TOOLS = new Set(['machine_search', 'read_machine_file', 'machine_tree',
  'list_machine_roots', 'register_machine_root', 'unregister_machine_root', 'verify_retrieval_evidence']);
export const SESSION_RUNTIME_TOOLS = new Set(['takeover_session', 'get_session_writer', 'get_session_output', 'start_session', 'stop_session', 'dispatch_task_to_session', 'create_session', 'pm_execute_task_packet', 'terminal_run', 'terminal_open', 'terminal_close']);
/** Goal self-management and sandbox tools are only visible to runs carrying a goal (or a coding sub-run). */
export const GOAL_TOOLS = new Set(['goal_add_tasks', 'goal_update_task', 'goal_write_journal', 'goal_ask_user',
  'goal_file_read', 'goal_file_write', 'goal_file_edit', 'goal_run_checks', 'goal_delegate', 'goal_dispatch_task']);
/** Read-only project task catalog (research/review) plus the repair submission exception. */
export const PROJECT_READS = new Set(['get_project_git_status', 'read_project_diff', 'read_tool_result', 'get_project', 'list_project_files', 'read_project_file', 'search_project_files', 'machine_search', 'read_machine_file', 'machine_tree', 'list_machine_roots', 'verify_retrieval_evidence', 'route_query',
  'project_graph_search', 'project_graph_symbol_detail', 'project_graph_impact', 'project_graph_affected_paths',
  'get_development_task', 'list_development_tasks', 'pm_get_task_progress']);
/**
 * Coding sub-run surface: the goal sandbox/self tools named by the delegate
 * contract, plus goal_delegate itself (a nested delegate attempt is refused
 * at admission with COPILOT_RESTRICTED_ORIGIN — the parent-chain depth rule).
 * goal_add_tasks / goal_ask_user / goal_dispatch_task stay parent-only.
 */
export const CODING_READS: ReadonlySet<string> = new Set([...PROJECT_READS,
  'goal_file_read', 'goal_file_write', 'goal_file_edit', 'goal_run_checks', 'goal_update_task', 'goal_write_journal', 'goal_delegate']);
/**
 * Operate-class tools a coding sub-run may still call. They keep the normal
 * approval gate (or the goal's sandbox_checks grant); restricted mode only
 * decides visibility.
 */
export const CODING_OPERATES: ReadonlySet<string> = new Set(['goal_run_checks']);
/** Layer names in evaluation order. */
export const TOOL_SURFACE_LAYERS = ['retired', 'scheduled-readonly', 'restricted-mode', 'session-runtime', 'mcp-source', 'owner-disabled', 'goal-catalog', 'on-demand'] as const;
export type ToolSurfaceLayer = (typeof TOOL_SURFACE_LAYERS)[number];

export interface ToolSurfaceInput { source?: TurnInput['source']; executionMode?: TurnInput['executionMode']; channelScope?: TurnInput['channelScope']; goalId?: TurnInput['goalId']; toolDiscovery?: TurnInput['toolDiscovery'] }

/**
 * Project board planning tools (~2.4k schema tokens). Offered to goal runs —
 * where long-lived planning happens — and to discovery-mode runs, which load
 * them on demand; plain chat keeps its default tool budget.
 */
export const BOARD_PLANNING_TOOLS: ReadonlySet<string> = new Set(['pm_get_plan', 'pm_get_handoff', 'pm_set_goal',
  'pm_update_task_plan', 'pm_manage_stage', 'pm_manage_dependency', 'pm_attach_evidence']);
export interface ToolSurfaceContext {
  registry: AgentToolRegistry;
  hasSessionManager: boolean;
  isToolDisabled?: ((name: string) => boolean) | undefined;
}
export interface ToolExclusion { layer: ToolSurfaceLayer; reason: string }

export interface ToolSurface {
  visible: AgentLlmToolSchema[];
  exclusions: Array<{ layer: ToolSurfaceLayer; toolName: string }>;
  /** First excluding verdict for a tool in layer-evaluation order, if any. */
  exclusion: (toolName: string) => ToolExclusion | undefined;
  excluded: (toolName: string, layer: ToolSurfaceLayer) => boolean;
  /** Legacy unavailable code (TOOL_RETIRED / SESSION_RUNTIME_UNAVAILABLE). */
  unavailableReason: (toolName: string) => string | null;
}

const NON_USER_HIDDEN_TOOLS = ['takeover_session', 'submit_development_task', 'cancel_development_task', 'accept_development_task'];

function exclusionReasons(input: ToolSurfaceInput, context: ToolSurfaceContext, name: string, risk: string | undefined): ToolExclusion[] {
  const repairSubmit = input.executionMode === 'repair' && name === 'submit_development_task';
  const scheduled = input.source === 'scheduled';
  const nonUser = scheduled || input.source === 'reactive';
  const verdicts: ToolExclusion[] = [];
  if (RETIRED_TOOLS.has(name)) verdicts.push({ layer: 'retired', reason: 'TOOL_RETIRED' });
  if (nonUser && (NON_USER_HIDDEN_TOOLS.includes(name) || name.startsWith('mcp_'))) verdicts.push({ layer: 'scheduled-readonly', reason: 'NON_USER_SOURCE_HIDDEN' });
  if (scheduled && risk !== 'read') verdicts.push({ layer: 'scheduled-readonly', reason: 'SCHEDULED_READ_ONLY' });
  if (input.channelScope && LOCAL_MACHINE_ROOT_TOOLS.has(name))
    verdicts.push({ layer: 'restricted-mode', reason: 'CHANNEL_LOCAL_MACHINE_ROOTS_CLOSED' });
  const codingOperate = input.executionMode === 'coding' && CODING_OPERATES.has(name);
  if (input.executionMode && !repairSubmit && (!(input.executionMode === 'coding' ? CODING_READS : PROJECT_READS).has(name) || (risk !== 'read' && !codingOperate))) verdicts.push({ layer: 'restricted-mode', reason: 'RESTRICTED_MODE' });
  if (SESSION_RUNTIME_TOOLS.has(name) && !context.hasSessionManager) verdicts.push({ layer: 'session-runtime', reason: 'SESSION_RUNTIME_UNAVAILABLE' });
  if (name.startsWith('mcp_') && input.source && input.source !== 'user') verdicts.push({ layer: 'mcp-source', reason: 'MCP_SOURCE_AUTHORITY' });
  if (context.isToolDisabled?.(name)) verdicts.push({ layer: 'owner-disabled', reason: 'OWNER_DISABLED' });
  if (GOAL_TOOLS.has(name) && !input.goalId && input.executionMode !== 'coding') verdicts.push({ layer: 'goal-catalog', reason: 'GOAL_CATALOG' });
  if (BOARD_PLANNING_TOOLS.has(name) && !input.goalId && input.toolDiscovery !== true) verdicts.push({ layer: 'goal-catalog', reason: 'GOAL_CATALOG' });
  if (ON_DEMAND_TOOLS.has(name) && input.toolDiscovery !== true) verdicts.push({ layer: 'on-demand', reason: 'ON_DEMAND_TOOL' });
  return verdicts;
}

export function computeToolSurface(input: ToolSurfaceInput, context: ToolSurfaceContext): ToolSurface {
  const registered = context.registry.tools;
  const exclusions: Array<{ layer: ToolSurfaceLayer; toolName: string }> = [];
  const byTool = new Map<string, ToolExclusion[]>();
  const visible = context.registry.toModelSchemas().filter(tool => {
    const verdicts = exclusionReasons(input, context, tool.name, registered.get(tool.name)?.risk);
    if (!verdicts.length) return true;
    for (const verdict of verdicts) if (!exclusions.some(exclusion => exclusion.toolName === tool.name && exclusion.layer === verdict.layer))
      exclusions.push({ layer: verdict.layer, toolName: tool.name });
    byTool.set(tool.name, verdicts);
    return false;
  });
  return {
    visible, exclusions,
    exclusion: (toolName) => byTool.get(toolName)?.[0],
    excluded: (toolName, layer) => byTool.get(toolName)?.some(verdict => verdict.layer === layer) ?? false,
    unavailableReason: (toolName) => {
      const verdict = byTool.get(toolName)?.find(verdict => verdict.layer === 'retired' || verdict.layer === 'session-runtime');
      return verdict?.reason ?? null;
    },
  };
}
