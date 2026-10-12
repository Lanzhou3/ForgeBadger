import { computeToolSurface, RETIRED_TOOLS, SESSION_RUNTIME_TOOLS } from './tool-surface.js';
import type { AgentToolRegistry } from './tool-registry.js';

/** Availability is distinct from owner preferences and per-action authorization. */
export function toolUnavailableReason(name: string, hasSessionManager: boolean): string | null {
  if (RETIRED_TOOLS.has(name)) return 'TOOL_RETIRED';
  if (SESSION_RUNTIME_TOOLS.has(name) && !hasSessionManager) return 'SESSION_RUNTIME_UNAVAILABLE';
  return null;
}

export interface ToolVisibilityOptions {
  hasSessionManager: boolean;
  isToolDisabled?: ((name: string) => boolean) | undefined;
  scheduled?: boolean;
  reactive?: boolean;
}

/** Model-visible catalog: the scheduled/reactive/availability projection of computeToolSurface. */
export function visibleToolSchemas(registry: AgentToolRegistry, options: ToolVisibilityOptions) {
  return computeToolSurface({
    source: options.scheduled ? 'scheduled' : options.reactive ? 'reactive' : 'user',
  }, { registry, hasSessionManager: options.hasSessionManager, isToolDisabled: options.isToolDisabled }).visible;
}
