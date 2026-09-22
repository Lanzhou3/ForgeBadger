import { fetchJson } from "@/lib/api";

export interface ExtensionFile { path: string; content: string; }
export interface SkillSource { kind: "builtin" | "paste" | "upload" | "url" | "legacy"; url?: string; label?: string; }
export interface CopilotSkill {
  id: string; name: string; description: string; kind: "builtin-playbook" | "imported";
  version: string; currentVersion: string; revisionId: string; source: SkillSource;
  isEnabled: boolean; available: boolean; unavailableReason: string | null;
  compatible: boolean; incompatibilityReasons: string[]; requiredTools: string[];
  reviewRequired: boolean; editable: boolean; updatedAt: string;
}
export interface CopilotSkillDetail extends CopilotSkill { files: ExtensionFile[]; content: string; }
export interface SkillRevision {
  id: string; version: string; source: SkillSource; createdAt: string; packageDigest: string;
  fileCount: number; action: "import" | "update" | "rollback" | "legacy" | "builtin-update";
}
export type SkillImport = { source: { kind: "paste" | "upload"; label?: string }; files: ExtensionFile[] }
  | { source: { kind: "url"; url: string } };
export interface ConnectionTool {
  name: string; modelName: string; description: string; inputSchema: Record<string, unknown>;
  enabled: boolean; compatible: boolean; unavailableReason: string | null;
}
export interface CopilotConnection {
  id: string; name: string; kind: "builtin" | "mcp"; endpoint: string | null;
  enabled: boolean; revision: number; hasCredential: boolean; status: "ready" | "not_discovered";
  tools: ConnectionTool[]; lastDiscoveredAt: number | null;
}
const root = "/api/v1/copilot";
const skillPath = (id: string) => `${root}/skills/${encodeURIComponent(id)}`;
const connectionPath = (id: string) => `${root}/connections/${encodeURIComponent(id)}`;
export const copilotSkillsKey = ["copilot", "skills"] as const;
export const copilotConnectionsKey = ["copilot", "connections"] as const;
export const listCopilotSkills = () => fetchJson<{ skills: CopilotSkill[] }>(`${root}/skills`);
export const getCopilotSkill = (id: string) => fetchJson<{ skill: CopilotSkillDetail }>(skillPath(id));
export const importCopilotSkill = (input: SkillImport) => fetchJson<{ skill: CopilotSkillDetail }>(`${root}/skills/imports`, { method: "POST", body: JSON.stringify(input) });
export const updateCopilotSkill = (id: string, input: { expectedRevisionId: string; files: ExtensionFile[]; reviewedVersion?: string }) => fetchJson<{ skill: CopilotSkillDetail }>(skillPath(id), { method: "PUT", body: JSON.stringify(input) });
export const setCopilotSkillEnabled = (id: string, enabled: boolean, expectedRevisionId: string) => fetchJson<{ skill: CopilotSkillDetail }>(`${skillPath(id)}/enabled`, { method: "PUT", body: JSON.stringify({ enabled, expectedRevisionId }) });
export const listSkillRevisions = (id: string) => fetchJson<{ revisions: SkillRevision[] }>(`${skillPath(id)}/revisions`);
export const getSkillRevision = (id: string, revisionId: string) => fetchJson<{ revision: SkillRevision & { files: ExtensionFile[] } }>(`${skillPath(id)}/revisions/${encodeURIComponent(revisionId)}`);
export const rollbackCopilotSkill = (id: string, revisionId: string, expectedRevisionId: string) => fetchJson<{ skill: CopilotSkillDetail }>(`${skillPath(id)}/rollback`, { method: "POST", body: JSON.stringify({ revisionId, expectedRevisionId }) });
export const listCopilotConnections = () => fetchJson<{ connections: CopilotConnection[] }>(`${root}/connections`);
export const createCopilotConnection = (input: { name: string; endpoint: string; bearerToken?: string }) => fetchJson<{ connection: CopilotConnection }>(`${root}/connections`, { method: "POST", body: JSON.stringify(input) });
export const updateCopilotConnection = (id: string, input: { revision: number; name?: string; endpoint?: string; bearerToken?: string | null; enabled?: boolean; enabledTools?: string[] }) => fetchJson<{ connection: CopilotConnection }>(connectionPath(id), { method: "PUT", body: JSON.stringify(input) });
export const discoverCopilotConnection = (id: string, revision: number) => fetchJson<{ connection: CopilotConnection }>(`${connectionPath(id)}/discover`, { method: "POST", body: JSON.stringify({ revision }) });
export const deleteCopilotConnection = (id: string, revision: number) => fetchJson<{ deleted: boolean }>(`${connectionPath(id)}?revision=${revision}`, { method: "DELETE" });
