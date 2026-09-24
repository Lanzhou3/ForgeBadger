import type { AgentToolRegistry } from './tool-registry.js';

const sessionRuntimeTools = new Set(['takeover_session', 'get_session_writer', 'get_session_output', 'start_session', 'stop_session', 'dispatch_task_to_session', 'pm_execute_task_packet']);
const retiredTools = new Set(['pm_start_task_packet', 'list_skills', 'load_skill']);

/** Availability is distinct from owner preferences and per-action authorization. */
export function toolUnavailableReason(name: string, hasSessionManager: boolean): string | null {
  if (retiredTools.has(name)) return 'TOOL_RETIRED';
  if (sessionRuntimeTools.has(name) && !hasSessionManager) return 'SESSION_RUNTIME_UNAVAILABLE';
  return null;
}

export interface ToolVisibilityOptions {
  hasSessionManager: boolean;
  isToolDisabled?: ((name: string) => boolean) | undefined;
  scheduled?: boolean;
  reactive?: boolean;
}

export function visibleToolSchemas(registry: AgentToolRegistry, options: ToolVisibilityOptions) {
  const registered = registry.tools;
  return registry.toModelSchemas().filter(tool => {
    if (['takeover_session','submit_development_task','cancel_development_task','accept_development_task'].includes(tool.name) && (options.scheduled || options.reactive)) return false;
    if (tool.name.startsWith("mcp_") && (options.scheduled || options.reactive)) return false;
    if (toolUnavailableReason(tool.name, options.hasSessionManager) || options.isToolDisabled?.(tool.name)) return false;
    return !options.scheduled || registered.get(tool.name)?.risk === 'read';
  });
}
