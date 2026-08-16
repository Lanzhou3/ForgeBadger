import { digestPortfolioValue } from "../../db/repositories/portfolio-repository.js";
import { PORTFOLIO_EXECUTION_SKILL_VERSION, PORTFOLIO_EXECUTION_TOOL_IDS, PORTFOLIO_EXECUTION_TOOL_VERSION } from "./execution-contract.js";

export interface PlatformToolDefinition {
  id: string;
  version: string;
  actionClass: string;
  inputSchema: Record<string, unknown>;
}

export interface PlatformToolManifest {
  version: string;
  digest: string;
  tools: PlatformToolDefinition[];
}

export interface SelectedPlatformTools {
  skillVersion: string | null;
  manifestVersion: string;
  manifestDigest: string;
  tools: PlatformToolDefinition[];
}

interface ServerSkill {
  version: string;
  allowedToolIds: readonly string[];
}

const tools: readonly PlatformToolDefinition[] = [
  { id: "portfolio.collect_platform_lifecycle", version: "v1", actionClass: "observe_platform", inputSchema: { type: "object", additionalProperties: false } },
  { id: "portfolio.collect_declared_git_state", version: "v1", actionClass: "observe_git_state", inputSchema: { type: "object", additionalProperties: false } },
  { id: "portfolio.submit_canonical_task_packet", version: PORTFOLIO_EXECUTION_TOOL_VERSION, actionClass: "packet_submit", inputSchema: { type: "object", additionalProperties: false } }
];

const skills: readonly ServerSkill[] = [
  { version: PORTFOLIO_EXECUTION_SKILL_VERSION, allowedToolIds: PORTFOLIO_EXECUTION_TOOL_IDS },
  { version: "portfolio-observation/v1", allowedToolIds: ["portfolio.collect_platform_lifecycle", "portfolio.collect_declared_git_state"] }
];

function toManifest(version: string, entries: readonly PlatformToolDefinition[]): PlatformToolManifest {
  const normalized = entries.map((tool) => ({ ...tool, inputSchema: { ...tool.inputSchema } }));
  return { version, digest: digestPortfolioValue({ version, tools: normalized }), tools: normalized };
}

/** Server-owned static manifests keep packet history resolvable after a later manifest change. */
export function createPlatformToolManifestService() {
  const historical = new Map<string, PlatformToolManifest>([["platform-tools/v1", toManifest("platform-tools/v1", tools)]]);

  function current(): PlatformToolManifest {
    return get("platform-tools/v1");
  }

  function get(version: string): PlatformToolManifest {
    const manifest = historical.get(version);
    if (!manifest) throw new Error("PORTFOLIO_PLATFORM_MANIFEST_UNKNOWN");
    return { ...manifest, tools: manifest.tools.map((tool) => ({ ...tool, inputSchema: { ...tool.inputSchema } })) };
  }

  function selectFromManifest(
    manifest: PlatformToolManifest,
    input: { skillVersion?: string; toolIds?: string[]; rawShellText?: unknown }
  ): SelectedPlatformTools {
    if (input.rawShellText !== undefined) throw new Error("PORTFOLIO_RAW_SHELL_REJECTED");
    const skill = input.skillVersion ? skills.find((candidate) => candidate.version === input.skillVersion) : undefined;
    if (input.skillVersion && !skill) throw new Error("PORTFOLIO_SKILL_VERSION_UNKNOWN");
    const requested = [...new Set(input.toolIds ?? skill?.allowedToolIds ?? [])];
    const allowed = new Set(skill?.allowedToolIds ?? []);
    if (requested.some((toolId) => !allowed.has(toolId))) throw new Error("PORTFOLIO_SKILL_AUTHORITY_WIDENING");
    const selected = requested.map((toolId) => manifest.tools.find((tool) => tool.id === toolId));
    if (selected.some((tool) => !tool)) throw new Error("PORTFOLIO_PLATFORM_TOOL_UNKNOWN");
    return { skillVersion: skill?.version ?? null, manifestVersion: manifest.version, manifestDigest: manifest.digest, tools: selected as PlatformToolDefinition[] };
  }

  function select(input: { skillVersion?: string; toolIds?: string[]; rawShellText?: unknown }): SelectedPlatformTools {
    return selectFromManifest(current(), input);
  }

  /** Dispatchable packets may only use the explicit server-owned execution skill. */
  function selectExecutable(input: { skillVersion?: string; toolIds?: string[]; manifestVersion?: string }): SelectedPlatformTools & { skillVersion: string } {
    if (input.skillVersion !== PORTFOLIO_EXECUTION_SKILL_VERSION) throw new Error("PORTFOLIO_EXECUTABLE_SKILL_REQUIRED");
    if (!input.toolIds || input.toolIds.length === 0) throw new Error("PORTFOLIO_EXECUTABLE_TOOLS_REQUIRED");
    if (input.toolIds.some((toolId) => !PORTFOLIO_EXECUTION_TOOL_IDS.includes(toolId as (typeof PORTFOLIO_EXECUTION_TOOL_IDS)[number]))) {
      throw new Error("PORTFOLIO_EXECUTABLE_TOOL_UNREGISTERED");
    }
    const selected = selectFromManifest(input.manifestVersion ? get(input.manifestVersion) : current(), {
      skillVersion: input.skillVersion, toolIds: input.toolIds
    });
    if (selected.tools.length !== PORTFOLIO_EXECUTION_TOOL_IDS.length
      || selected.tools.some((tool) => !PORTFOLIO_EXECUTION_TOOL_IDS.includes(tool.id as (typeof PORTFOLIO_EXECUTION_TOOL_IDS)[number]))) {
      throw new Error("PORTFOLIO_EXECUTABLE_TOOL_UNREGISTERED");
    }
    if (!selected.skillVersion) throw new Error("PORTFOLIO_EXECUTABLE_SKILL_REQUIRED");
    return { ...selected, skillVersion: selected.skillVersion };
  }

  return { current, get, select, selectExecutable };
}
