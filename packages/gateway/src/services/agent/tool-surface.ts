import type { AgentToolRegistry } from './tool-registry.js';
import type { AgentLlmToolSchema } from './orchestrator-types.js';
import type { TurnInput } from './run-ledger.js';

/**
 * Plane A of the tool surface: one named, ordered layer computation that both
 * the model-visible catalog and the execution-time gate project from. Layers
 * run retired → scheduled-readonly → channel-catalog → restricted-mode →
 * session-runtime → mcp-source → owner-disabled; each exclusion records its
 * layer so rejection provenance (e.g. the run-trace tool_gate reason) names
 * the plane that closed the tool. The execution gate in orchestrator.toolStep
 * preserves its historical check ORDER — ordering is behavior there.
 */
export const RETIRED_TOOLS = new Set(['pm_start_task_packet', 'list_skills', 'load_skill']);
export const SESSION_RUNTIME_TOOLS = new Set(['takeover_session', 'get_session_writer', 'get_session_output', 'start_session', 'stop_session', 'dispatch_task_to_session', 'pm_execute_task_packet', 'terminal_run', 'terminal_open', 'terminal_close']);
/** Read-only project task catalog (research/review) plus the repair submission exception. */
export const PROJECT_READS = new Set(['get_project_git_status', 'read_project_diff', 'read_tool_result', 'get_project', 'list_project_files', 'read_project_file', 'search_project_files',
  'project_graph_search', 'project_graph_symbol_detail', 'project_graph_impact', 'project_graph_affected_paths',
  'get_development_task', 'list_development_tasks', 'pm_get_task_progress']);
/** Explicit channel catalog: global data and new/extension tools remain closed until audited. */
export const CHANNEL_TOOLS = new Set(['list_projects', 'get_project', 'list_sessions', 'get_session', 'get_session_output', 'get_session_writer',
  'pm_overview', 'pm_get_goal', 'pm_get_work_item', 'pm_list_ledger', 'pm_get_management', 'pm_list_task_packets', 'pm_get_task_packet',
  'pm_get_task_progress', 'pm_close_task', 'pm_create_work_item', 'pm_update_work_item', 'pm_update_management', 'update_project', 'start_session', 'stop_session',
  'dispatch_task_to_session', 'pm_prepare_task_packet', 'pm_execute_task_packet', 'search_memory', 'list_memory', 'write_memory',
  'list_project_files', 'read_project_file', 'search_project_files', 'get_project_git_status', 'read_project_diff',
  'project_graph_search', 'project_graph_symbol_detail', 'project_graph_impact', 'project_graph_affected_paths',
  'list_development_tasks', 'get_development_task', 'research_project', 'discover_tools', 'read_tool_result']);

/** Layer names in evaluation order. */
export const TOOL_SURFACE_LAYERS = ['retired', 'scheduled-readonly', 'channel-catalog', 'restricted-mode', 'session-runtime', 'mcp-source', 'owner-disabled'] as const;
export type ToolSurfaceLayer = (typeof TOOL_SURFACE_LAYERS)[number];

export interface ToolSurfaceInput { source?: TurnInput['source']; executionMode?: TurnInput['executionMode']; channelScope?: TurnInput['channelScope'] }
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
  if (input.channelScope && !CHANNEL_TOOLS.has(name) && !repairSubmit) verdicts.push({ layer: 'channel-catalog', reason: 'CHANNEL_CATALOG' });
  if (input.executionMode && !repairSubmit && (!PROJECT_READS.has(name) || risk !== 'read')) verdicts.push({ layer: 'restricted-mode', reason: 'RESTRICTED_MODE' });
  if (SESSION_RUNTIME_TOOLS.has(name) && !context.hasSessionManager) verdicts.push({ layer: 'session-runtime', reason: 'SESSION_RUNTIME_UNAVAILABLE' });
  if (name.startsWith('mcp_') && input.source && input.source !== 'user') verdicts.push({ layer: 'mcp-source', reason: 'MCP_SOURCE_AUTHORITY' });
  if (context.isToolDisabled?.(name)) verdicts.push({ layer: 'owner-disabled', reason: 'OWNER_DISABLED' });
  return verdicts;
}

/** Channel catalog gate: the channel-catalog layer of computeToolSurface. */
export function channelToolAllowed(input: ToolSurfaceInput, name: string): boolean {
  return !input.channelScope || CHANNEL_TOOLS.has(name) || input.executionMode === 'repair' && name === 'submit_development_task';
}

export function computeToolSurface(input: ToolSurfaceInput, context: ToolSurfaceContext): ToolSurface {
  const registered = context.registry.tools;
  const exclusions: Array<{ layer: ToolSurfaceLayer; toolName: string }> = [];
  const byTool = new Map<string, ToolExclusion>();
  const visible = context.registry.toModelSchemas().filter(tool => {
    const verdicts = exclusionReasons(input, context, tool.name, registered.get(tool.name)?.risk);
    if (!verdicts.length) return true;
    for (const verdict of verdicts) if (!exclusions.some(exclusion => exclusion.toolName === tool.name && exclusion.layer === verdict.layer))
      exclusions.push({ layer: verdict.layer, toolName: tool.name });
    if (!byTool.has(tool.name)) byTool.set(tool.name, verdicts[0]!);
    return false;
  });
  return {
    visible, exclusions,
    exclusion: (toolName) => byTool.get(toolName),
    excluded: (toolName, layer) => byTool.get(toolName)?.layer === layer,
    unavailableReason: (toolName) => {
      const verdict = byTool.get(toolName);
      return verdict && (verdict.layer === 'retired' || verdict.layer === 'session-runtime') ? verdict.reason : null;
    },
  };
}
