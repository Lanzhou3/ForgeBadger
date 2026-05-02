import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { plugins } from "../schema.js";
import type { Database } from "../types.js";
import {
  getClaudePlugin,
  mergePluginStates,
  type PluginDefinition,
  type PluginSummary
} from "../../services/plugin-catalog.js";

export interface PluginState {
  id: string;
  userId: string;
  pluginId: string;
  status: "enabled" | "disabled";
  name: string | null;
  description: string | null;
  version: string | null;
  adapter: string | null;
  category: string | null;
  configPath: string | null;
  skillsJson: string | null;
  installSource: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InstallPluginInput {
  pluginId: string;
  name: string;
  description: string;
  version: string;
  adapter: "claude";
  category: "workflow" | "safety" | "integration";
  configPath: string;
  skills: PluginDefinition["skills"];
  installSource: string;
}

export class PluginRepository {
  private drizzle;

  constructor(db: Database, private userId: string) {
    this.drizzle = drizzle(db);
  }

  list(): PluginSummary[] {
    const rows = this.drizzle
      .select()
      .from(plugins)
      .where(eq(plugins.userId, this.userId))
      .all() as PluginState[];
    const enabledIds = new Set(
      rows.filter((row) => row.status === "enabled").map((row) => row.pluginId)
    );
    return mergePluginStates(enabledIds, rows.flatMap(pluginStateToDefinition));
  }

  getByPluginId(pluginId: string): PluginSummary | undefined {
    return this.list().find((plugin) => plugin.id === pluginId);
  }

  install(input: InstallPluginInput): PluginSummary {
    if (getClaudePlugin(input.pluginId)) {
      throw new Error("Plugin id conflicts with a built-in plugin");
    }

    const existing = this.drizzle
      .select()
      .from(plugins)
      .where(and(eq(plugins.userId, this.userId), eq(plugins.pluginId, input.pluginId)))
      .get() as PluginState | undefined;
    const values = {
      name: input.name,
      description: input.description,
      version: input.version,
      adapter: input.adapter,
      category: input.category,
      configPath: input.configPath,
      skillsJson: JSON.stringify(input.skills),
      installSource: input.installSource,
      status: "disabled" as const
    };

    if (existing) {
      this.drizzle
        .update(plugins)
        .set(values)
        .where(and(eq(plugins.userId, this.userId), eq(plugins.pluginId, input.pluginId)))
        .run();
    } else {
      this.drizzle
        .insert(plugins)
        .values({
          userId: this.userId,
          pluginId: input.pluginId,
          ...values
        })
        .run();
    }

    const plugin = this.getByPluginId(input.pluginId);
    if (!plugin) {
      throw new Error("Plugin install failed");
    }
    return plugin;
  }

  setEnabled(pluginId: string, enabled: boolean): PluginSummary | undefined {
    const existing = this.drizzle
      .select()
      .from(plugins)
      .where(and(eq(plugins.userId, this.userId), eq(plugins.pluginId, pluginId)))
      .get() as PluginState | undefined;
    const status = enabled ? "enabled" : "disabled";

    if (existing) {
      this.drizzle
        .update(plugins)
        .set({ status })
        .where(and(eq(plugins.userId, this.userId), eq(plugins.pluginId, pluginId)))
        .run();
    } else {
      this.drizzle
        .insert(plugins)
        .values({
          userId: this.userId,
          pluginId,
          status
        })
        .run();
    }

    return this.list().find((plugin) => plugin.id === pluginId);
  }
}

function pluginStateToDefinition(row: PluginState): PluginDefinition[] {
  if (
    !row.name ||
    !row.description ||
    !row.version ||
    row.adapter !== "claude" ||
    !isPluginCategory(row.category) ||
    !row.configPath ||
    !row.skillsJson
  ) {
    return [];
  }

  try {
    const skills = JSON.parse(row.skillsJson) as PluginDefinition["skills"];
    if (!Array.isArray(skills) || skills.length === 0) {
      return [];
    }
    return [{
      id: row.pluginId,
      name: row.name,
      description: row.description,
      version: row.version,
      adapter: "claude",
      category: row.category,
      configPath: row.configPath,
      skills
    }];
  } catch {
    return [];
  }
}

function isPluginCategory(value: string | null): value is PluginDefinition["category"] {
  return value === "workflow" || value === "safety" || value === "integration";
}
