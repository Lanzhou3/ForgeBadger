/**
 * Per-user dsh kernel configuration (M4): the visual configuration surface
 * that the Gateway renders into a per-user cordis.yml at runtime spawn.
 *
 * - `DSH_AVAILABLE_PLUGINS` is the whitelist the PUT API validates against and
 *   the template's feature markers reference.
 * - `renderCordisConfig` is a pure function over the packaged template: blocks
 *   wrapped in `# @openforge-feature: <id>` / `# @openforge-feature-end: <id>`
 *   comment markers are dropped when the feature is off. Markers are YAML
 *   comments, so the packaged template stays valid for the default (all-on)
 *   composition used by the M1-M3 spikes.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { CopilotDshConfigRepository } from "../../db/repositories/copilot-dsh-config-repository.js";
import type { Database } from "../../db/types.js";

export interface DshAvailablePlugin {
  id: string;
  label: string;
  description: string;
}

/** The optional runtime plugins a user may toggle. Order is display order. */
export const DSH_AVAILABLE_PLUGINS: readonly DshAvailablePlugin[] = Object.freeze([
  {
    id: "compaction",
    label: "上下文压缩",
    description: "长对话接近上下文上限时自动压缩历史（dsh-compaction-basic）。"
  },
  {
    id: "subagents",
    label: "子代理",
    description: "允许内核派生子代理处理子任务（dsh-subagent / tool-subagent）。"
  }
]);

export type DshPluginId = "compaction" | "subagents";

/** Defaults preserve the pre-M4 composition (both features mounted). */
export const DSH_DEFAULT_PLUGINS: Readonly<Record<DshPluginId, boolean>> = Object.freeze({
  compaction: true,
  subagents: true
});

const FEATURE_BEGIN = /^# @openforge-feature: ([a-z-]+)\s*$/;
const FEATURE_END = /^# @openforge-feature-end: ([a-z-]+)\s*$/;

/** Effective plugin map: stored overrides on top of defaults. */
export function effectivePlugins(stored: Record<string, boolean> | undefined): Record<DshPluginId, boolean> {
  const merged = { ...DSH_DEFAULT_PLUGINS };
  for (const id of Object.keys(DSH_DEFAULT_PLUGINS) as DshPluginId[]) {
    const value = stored?.[id];
    if (typeof value === "boolean") merged[id] = value;
  }
  return merged;
}

/** Plugin keys outside the whitelist; the PUT API rejects with 400 when non-empty. */
export function unknownPluginKeys(plugins: Record<string, boolean>): string[] {
  return Object.keys(plugins).filter((key) => !(key in DSH_DEFAULT_PLUGINS));
}

/**
 * Render the per-user cordis.yml from the packaged template by dropping
 * feature blocks whose plugin is off. Unbalanced/unknown markers throw — a
 * template drift must fail the spawn loudly, never silently mount the wrong
 * composition.
 */
export function renderCordisConfig(template: string, plugins: Record<DshPluginId, boolean>): string {
  const out: string[] = [];
  let skipping: string | null = null;
  for (const line of template.split("\n")) {
    const begin = FEATURE_BEGIN.exec(line);
    if (begin) {
      if (skipping !== null) throw new Error(`nested @openforge-feature marker: ${begin[1]} inside ${skipping}`);
      if (!(begin[1]! in DSH_DEFAULT_PLUGINS)) throw new Error(`unknown @openforge-feature marker: ${begin[1]}`);
      if (plugins[begin[1] as DshPluginId] === false) skipping = begin[1]!;
      continue;
    }
    const end = FEATURE_END.exec(line);
    if (end) {
      if (skipping === null) {
        if (!(end[1]! in DSH_DEFAULT_PLUGINS)) throw new Error(`unknown @openforge-feature-end marker: ${end[1]}`);
        continue; // enabled feature: drop only the marker line itself
      }
      if (skipping !== end[1]) throw new Error(`mismatched @openforge-feature-end: ${end[1]} (open: ${skipping})`);
      skipping = null;
      continue;
    }
    if (skipping === null) out.push(line);
  }
  if (skipping !== null) throw new Error(`unclosed @openforge-feature marker: ${skipping}`);
  return out.join("\n");
}

/** Read the user's effective dsh config (defaults when no row exists). */
export function getEffectiveDshConfig(db: Database, userId: string): {
  defaultModelId: string | null;
  plugins: Record<DshPluginId, boolean>;
} {
  const stored = new CopilotDshConfigRepository(db, userId).get();
  return {
    defaultModelId: stored?.defaultModelId ?? null,
    plugins: effectivePlugins(stored?.plugins)
  };
}

/** The model profile a dsh run resolves when the message names none. */
export function resolveDshModelOverride(db: Database, userId: string): string | undefined {
  return new CopilotDshConfigRepository(db, userId).get()?.defaultModelId ?? undefined;
}

/**
 * Build the process-manager renderConfig hook. The template ships inside the
 * dsh-bridge package (`dist/launcher.js` -> `../templates/cordis.yml`); when
 * it is absent (tests with a fake launcher) the hook returns undefined and the
 * runtime boots the packaged default composition. The template is re-read at
 * every spawn so a template update needs no gateway restart.
 */
export function createCordisConfigRenderer(db: Database, launcherPath: string, templatePath?: string): (userId: string) => string | undefined {
  const resolvedTemplatePath = templatePath ?? join(dirname(launcherPath), "..", "templates", "cordis.yml");
  return (userId) => {
    if (!existsSync(resolvedTemplatePath)) return undefined;
    const template = readFileSync(resolvedTemplatePath, "utf8");
    return renderCordisConfig(template, getEffectiveDshConfig(db, userId).plugins);
  };
}
