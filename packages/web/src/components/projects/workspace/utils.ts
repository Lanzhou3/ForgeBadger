import type { WorkspaceTreeEntry } from "@/lib/api";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function flattenWorkspaceFiles(entries: WorkspaceTreeEntry[]): WorkspaceTreeEntry[] {
  return entries.flatMap((entry) => {
    if (entry.kind === "directory") {
      return flattenWorkspaceFiles(entry.children ?? []);
    }
    return entry.kind === "file" ? [entry] : [];
  });
}

export function filterWorkspaceFiles(
  entries: WorkspaceTreeEntry[],
  term: string,
  limit = 100
): WorkspaceTreeEntry[] {
  const normalized = term.trim().toLowerCase();
  if (!normalized) return [];
  return flattenWorkspaceFiles(entries)
    .filter(
      (entry) =>
        entry.name.toLowerCase().includes(normalized) ||
        entry.path.toLowerCase().includes(normalized)
    )
    .slice(0, limit);
}

/** "a/b/c.ts" -> ["a", "a/b"] */
export function ancestorPaths(path: string): string[] {
  const segments = path.split("/");
  const ancestors: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    ancestors.push(segments.slice(0, index).join("/"));
  }
  return ancestors;
}

export function formatWorkspaceTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
