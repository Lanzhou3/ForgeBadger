import { fetchJson, type Skill } from "./api";

export type SkillLocator =
  | {
      kind: "github";
      repo: string;
      path?: string;
      ref?: string;
      skillName?: string;
    }
  | { kind: "clawhub"; owner: string; slug: string; version?: string }
  | { kind: "raw"; url: string };
export interface SkillCandidate {
  id: string;
  name: string;
  description: string;
  provider: string;
  sourceLabel: string;
  sourceUrl: string;
  locator: SkillLocator;
  installedSkillId?: string;
}
export interface SkillSearchResult {
  items: SkillCandidate[];
  total: number;
  page: number;
  hasMore: boolean;
  statuses: Array<{ provider: string; status: string; message?: string }>;
}
export interface SkillRegistrySource {
  id: string;
  sourceId: string;
  label: string;
  url: string;
  status: string;
  lastRefreshedAt: string | null;
}
export interface SkillPackagePreview {
  token: string;
  expiresAt: string;
  operation: "install" | "update" | "rollback";
  skillId?: string;
  revision: string;
  canonicalId: string;
  sourceUrl: string;
  locator: SkillLocator;
  package: {
    name: string;
    description: string;
    version: string;
    license?: string;
    compatibility?: string;
    warnings: string[];
    packageHash: string;
    sizeBytes: number;
    files: Array<{ path: string; content: string }>;
  };
  changes: Array<{
    path: string;
    kind: "added" | "removed" | "modified";
    before?: string;
    after?: string;
  }>;
}
export interface SkillRevision {
  id: string;
  action: string;
  packageHash: string;
  createdAt: number;
}
export type PreviewInput = {
  locator?: SkillLocator;
  skillId?: string;
  revisionId?: string;
};
const root = "/api/v1/skills/registry";
const post = (body: unknown) => ({
  method: "POST",
  body: JSON.stringify(body),
  timeoutMs: 65_000,
});
export const searchSkillRegistry = (
  input: {
    q: string;
    provider: string;
    page: number;
    includeSkillsSh: boolean;
  },
  signal?: AbortSignal,
) =>
  fetchJson<SkillSearchResult>(
    `${root}/search?${new URLSearchParams({ ...input, page: String(input.page), includeSkillsSh: String(input.includeSkillsSh) })}`,
    { signal },
  );
export const listSkillRegistrySources = () =>
  fetchJson<{ sources: SkillRegistrySource[] }>(`${root}/sources`);
export const bootstrapSkillRegistry = () =>
  fetchJson(`${root}/bootstrap`, post({}));
export const refreshSkillRegistrySource = (repo: string) =>
  fetchJson(`${root}/sources`, post({ repo }));
export const removeSkillRegistrySource = (id: string) =>
  fetchJson(`${root}/sources/${encodeURIComponent(id)}`, { method: "DELETE" });
export const previewSkillPackage = (input: PreviewInput) =>
  fetchJson<SkillPackagePreview>(`${root}/preview`, post(input));
export const installSkillPackage = (
  preview: SkillPackagePreview,
  projectId?: string,
) =>
  fetchJson<{ skill: Skill; projectId?: string }>(
    `${root}/install`,
    post({
      token: preview.token,
      operation: preview.operation,
      skillId: preview.skillId,
      ...(projectId ? { projectId } : {}),
    }),
  );
export const listSkillRevisions = (id: string) =>
  fetchJson<{ revisions: SkillRevision[] }>(
    `/api/v1/skills/${encodeURIComponent(id)}/revisions`,
  );
