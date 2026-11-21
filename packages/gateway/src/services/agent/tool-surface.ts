import type { AgentToolRegistry } from './tool-registry.js';
import type { AgentLlmToolSchema } from './orchestrator-types.js';
import type { TurnInput } from './run-ledger.js';

/**
 * Plane A of the tool surface: one named, ordered layer computation that both
 * the model-visible catalog and the execution-time gate project from. Layers
 * run retired → scheduled-readonly → restricted-mode → session-runtime →
 * mcp-source → fleet-authority → owner-disabled → goal-catalog → context-catalog; each exclusion
 * records its layer so rejection provenance (e.g. the run-trace tool_gate
 * reason) names the plane that closed the tool. The execution gate in
 * orchestrator.toolStep preserves its historical check ORDER — ordering is
 * behavior there.
 */
export const RETIRED_TOOLS = new Set(['pm_start_task_packet', 'list_skills', 'load_skill']);
/** Local paths and contents stay out of channel-originated model context. */
export const LOCAL_MACHINE_ROOT_TOOLS = new Set(['machine_search', 'read_machine_file', 'machine_tree',
  'list_machine_roots', 'register_machine_root', 'unregister_machine_root', 'verify_retrieval_evidence']);
/**
 * Tools that only work against an owner-registered local root. Until the
 * owner has at least one root they are dead weight in the catalog (~3.5 KB of
 * schema, 5 of ~60 tools), so they stay out of it; register_machine_root and
 * list_machine_roots remain as the entry points. Visibility only: execution
 * is still guarded by the root lookup in agent-scope.
 */
export const MACHINE_ROOT_DEPENDENT_TOOLS = new Set(['machine_search', 'read_machine_file', 'machine_tree',
  'verify_retrieval_evidence', 'unregister_machine_root']);
export const SESSION_RUNTIME_TOOLS = new Set(['takeover_session', 'get_session_writer', 'get_session_output', 'start_session', 'stop_session', 'dispatch_task_to_session', 'create_session', 'pm_execute_task_packet', 'terminal_run', 'terminal_open', 'terminal_close']);
/** Goal self-management and sandbox tools are only visible to runs carrying a goal (or a coding sub-run). */
export const GOAL_TOOLS = new Set(['goal_add_tasks', 'goal_update_task', 'goal_write_journal', 'goal_ask_user',
  'goal_file_read', 'goal_file_write', 'goal_file_edit', 'goal_run_checks', 'goal_delegate', 'goal_dispatch_task', 'goal_integrate_task',
  'goal_review_task', 'goal_get_review']);
/**
 * Fleet lead tools (tools/fleet.ts): visible only in runs whose scope is a
 * fleet (ToolSurfaceInput.fleet); each tool also refuses a non-fleet run itself.
 */
export const FLEET_TOOLS: ReadonlySet<string> = new Set<string>(['fleet_hold_task', 'fleet_set_timer', 'fleet_cancel_timer',
  'fleet_write_note', 'fleet_read_note']);
/** Goal tools a fleet run does not see: a fleet holds one task (fleet_hold_task), never the whole scope. */
export const FLEET_HIDDEN_GOAL_TOOLS: ReadonlySet<string> = new Set(['goal_ask_user']);
/** Read-only project task catalog (research sub-runs). */
export const PROJECT_READS = new Set(['get_project_git_status', 'read_project_diff', 'read_tool_result', 'get_project', 'list_project_files', 'read_project_file', 'search_project_files', 'machine_search', 'read_machine_file', 'machine_tree', 'list_machine_roots', 'verify_retrieval_evidence',
  'project_graph_search', 'project_graph_symbol_detail', 'project_graph_impact', 'project_graph_affected_paths',
  'pm_get_task_progress']);
/**
 * Coding sub-run surface: the goal sandbox/self tools named by the delegate
 * contract, plus goal_delegate itself (a nested delegate attempt is refused
 * at admission with COPILOT_RESTRICTED_ORIGIN — the parent-chain depth rule).
 * goal_add_tasks / goal_ask_user / goal_dispatch_task / goal_review_task stay parent-only.
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
export const TOOL_SURFACE_LAYERS = ['retired', 'scheduled-readonly', 'restricted-mode', 'session-runtime', 'mcp-source', 'fleet-authority', 'owner-disabled', 'goal-catalog', 'context-catalog'] as const;
export type ToolSurfaceLayer = (typeof TOOL_SURFACE_LAYERS)[number];

export interface ToolSurfaceInput {
  source?: TurnInput['source']; executionMode?: TurnInput['executionMode']; channelScope?: TurnInput['channelScope']; goalId?: TurnInput['goalId'];
  mode?: TurnInput['mode'];
  projectId?: TurnInput['projectId'];
  /** The run's scope id (goalId) is a fleet. Computed by the caller (scopeKind) wherever goalId is known; absent means a goal or no scope. */
  fleet?: boolean;
}

/**
 * Project board planning tools (~2.4k schema tokens). Offered to goal runs,
 * where long-lived planning happens; plain chat keeps its default tool budget.
 */
export const BOARD_PLANNING_TOOLS: ReadonlySet<string> = new Set(['pm_get_plan', 'pm_get_handoff', 'pm_set_goal',
  'pm_update_task_plan', 'pm_manage_stage', 'pm_manage_dependency', 'pm_attach_evidence']);
export interface ToolSurfaceContext {
  registry: AgentToolRegistry;
  hasSessionManager: boolean;
  isToolDisabled?: ((name: string) => boolean) | undefined;
  /** False hides root-dependent machine tools. Omitted means unknown: keep them visible. */
  hasMachineRoots?: boolean | undefined;
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

const NON_USER_HIDDEN_TOOLS = ['takeover_session'];
/** Model-initiated mode tools: only owner-driven top-level runs (no goal/fleet/sub-run scope) may use them. */
export const MODE_TOOLS: ReadonlySet<string> = new Set(['enter_plan_mode', 'propose_mode_switch']);

function modeToolAvailable(input: ToolSurfaceInput, name: string): boolean {
  if ((input.source ?? 'user') !== 'user' || input.channelScope || input.executionMode || input.goalId || input.fleet) return false;
  if (name === 'enter_plan_mode') return input.mode !== 'plan';
  // target "execute" is for plan mode; target "goal" needs a selected project in execute mode.
  return input.mode === 'plan' || !!input.projectId;
}
const PLAN_BOARD_READS = new Set(['pm_get_plan', 'pm_get_handoff']);
const PLAN_BLOCKED_TOOLS = new Set(['write_memory', 'register_machine_root', 'unregister_machine_root',
  ...SESSION_RUNTIME_TOOLS, ...GOAL_TOOLS, ...FLEET_TOOLS,
  ...[...BOARD_PLANNING_TOOLS].filter(name => !PLAN_BOARD_READS.has(name))]);

function exclusionReasons(input: ToolSurfaceInput, context: ToolSurfaceContext, name: string, risk: string | undefined): ToolExclusion[] {
  const scheduled = input.source === 'scheduled';
  const nonUser = scheduled || input.source === 'reactive';
  const verdicts: ToolExclusion[] = [];
  if (RETIRED_TOOLS.has(name)) verdicts.push({ layer: 'retired', reason: 'TOOL_RETIRED' });
  if (nonUser && (NON_USER_HIDDEN_TOOLS.includes(name) || name.startsWith('mcp_'))) verdicts.push({ layer: 'scheduled-readonly', reason: 'NON_USER_SOURCE_HIDDEN' });
  if (scheduled && risk !== 'read') verdicts.push({ layer: 'scheduled-readonly', reason: 'SCHEDULED_READ_ONLY' });
  if (input.channelScope && LOCAL_MACHINE_ROOT_TOOLS.has(name))
    verdicts.push({ layer: 'restricted-mode', reason: 'CHANNEL_LOCAL_MACHINE_ROOTS_CLOSED' });
  if (input.mode === 'plan' && (risk !== 'read' || PLAN_BLOCKED_TOOLS.has(name)))
    verdicts.push({ layer: 'restricted-mode', reason: 'PLAN_MODE_READ_ONLY' });
  if (MODE_TOOLS.has(name) && !modeToolAvailable(input, name))
    verdicts.push({ layer: 'restricted-mode', reason: 'MODE_TOOL_UNAVAILABLE' });
  if (name === 'submit_plan' && input.mode !== 'plan')
    verdicts.push({ layer: 'restricted-mode', reason: 'PLAN_MODE_REQUIRED' });
  if (name === 'submit_research_report' && input.executionMode !== 'research')
    verdicts.push({ layer: 'restricted-mode', reason: 'RESEARCH_RUN_REQUIRED' });
  const codingOperate = input.executionMode === 'coding' && CODING_OPERATES.has(name);
  const researchReport = input.executionMode === 'research' && name === 'submit_research_report';
  if (input.executionMode && ((!researchReport && !(input.executionMode === 'coding' ? CODING_READS : PROJECT_READS).has(name)) || (risk !== 'read' && !codingOperate))) verdicts.push({ layer: 'restricted-mode', reason: 'RESTRICTED_MODE' });
  if (SESSION_RUNTIME_TOOLS.has(name) && !context.hasSessionManager) verdicts.push({ layer: 'session-runtime', reason: 'SESSION_RUNTIME_UNAVAILABLE' });
  if (name.startsWith('mcp_') && input.source && input.source !== 'user') verdicts.push({ layer: 'mcp-source', reason: 'MCP_SOURCE_AUTHORITY' });
  // An event-woken flagship keeps source 'user' (grants depend on it) but never gets owner-only or external tools.
  if (input.fleet && (name.startsWith('mcp_') || NON_USER_HIDDEN_TOOLS.includes(name))) verdicts.push({ layer: 'fleet-authority', reason: 'FLEET_AUTHORITY' });
  if (context.isToolDisabled?.(name)) verdicts.push({ layer: 'owner-disabled', reason: 'OWNER_DISABLED' });
  if (GOAL_TOOLS.has(name) && !input.goalId && input.executionMode !== 'coding') verdicts.push({ layer: 'goal-catalog', reason: 'GOAL_CATALOG' });
  if (BOARD_PLANNING_TOOLS.has(name) && !input.goalId && !(input.mode === 'plan' && name === 'pm_get_plan'))
    verdicts.push({ layer: 'goal-catalog', reason: 'GOAL_CATALOG' });
  if (FLEET_TOOLS.has(name) && !(input.goalId && input.fleet)) verdicts.push({ layer: 'goal-catalog', reason: 'FLEET_CATALOG' });
  if (FLEET_HIDDEN_GOAL_TOOLS.has(name) && input.fleet) verdicts.push({ layer: 'goal-catalog', reason: 'FLEET_CATALOG' });
  if (context.hasMachineRoots === false && MACHINE_ROOT_DEPENDENT_TOOLS.has(name)) verdicts.push({ layer: 'context-catalog', reason: 'NO_MACHINE_ROOT' });
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
