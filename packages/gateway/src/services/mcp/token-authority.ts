import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { ProjectRepository } from "../../db/repositories/project-repository.js";
import { McpTokenRepository, parseMcpAllowedProjects, parseMcpTokenScopes, type McpAllowedProject } from "../../db/repositories/mcp-token-repository.js";
import type { Database } from "../../db/types.js";
import { validateProjectRoot } from "../../lib/safe-resolve.js";
import { canonicalRoot } from "../platform-commands/actions.js";
import type { CommandResources } from "../platform-commands/types.js";

const SENSITIVE_SEGMENTS = new Set([".ssh", ".aws", ".gnupg", ".config", ".codex", ".claude", ".kube", "credentials", "secrets"]);

export function validateMcpAllowedRoot(raw: string): string {
  const root = validateProjectRoot(raw);
  if (!statSync(root).isDirectory()) throw new Error("MCP allowed root must be a directory");
  const home = realpathSync(homedir());
  if (root === home || home.startsWith(`${root}${path.sep}`)) throw new Error("MCP allowed root must be narrower than the home directory");
  if (root.split(path.sep).some((part) => SENSITIVE_SEGMENTS.has(part.toLowerCase()))) throw new Error("MCP allowed root cannot be a credential directory");
  return root;
}

function assertWithinRoot(candidate: string, root: string): void {
  const resolved = canonicalRoot(candidate);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("MCP token project root is outside its allowed directory");
  }
  if (relative.split(path.sep).some((part) => SENSITIVE_SEGMENTS.has(part.toLowerCase()))) throw new Error("MCP token cannot operate in a credential directory");
}

function assertNoForeignProjectOverlap(db: Database, userId: string, candidate: string): void {
  const target = canonicalRoot(candidate);
  const rows = db.prepare("SELECT path FROM projects WHERE user_id != ?").all(userId) as Array<{ path: string }>;
  const inside = (value: string) => value === "" || (value !== ".." && !value.startsWith(`..${path.sep}`) && !path.isAbsolute(value));
  const overlaps = (foreign: string) => inside(path.relative(foreign, target)) || inside(path.relative(target, foreign));
  for (const row of rows) {
    if (overlaps(path.resolve(row.path))) throw new Error("MCP project path overlaps a foreign-owned project");
    let foreign: string;
    try {
      foreign = canonicalRoot(row.path);
    } catch {
      // A stale foreign path cannot invalidate unrelated tenants' projects.
      continue;
    }
    if (overlaps(foreign)) throw new Error("MCP project path overlaps a foreign-owned project");
  }
}

export function snapshotMcpProjects(db: Database, userId: string, projectIds: string[]): McpAllowedProject[] {
  const projects = new ProjectRepository(db, userId);
  const grants = [...new Set(projectIds)].map(id => {
    const project = projects.getById(id);
    if (!project) throw new Error("Selected project not found");
    const root = validateMcpAllowedRoot(project.path);
    assertNoForeignProjectOverlap(db, userId, root);
    return { id, root };
  });
  for (const grant of grants) assertNoUnselectedNestedProject(db, userId, grants, grant.root);
  return grants;
}

function assertNoUnselectedNestedProject(db: Database, userId: string, grants: McpAllowedProject[], root: string): void {
  for (const project of new ProjectRepository(db, userId).list()) {
    const grant = grants.find(item => item.id === project.id);
    if (grant) {
      try { if (validateMcpAllowedRoot(project.path) === grant.root) continue; } catch { /* Stale grants cannot authorize nested directories. */ }
    }
    const candidates = [path.resolve(project.path)];
    try { candidates.push(canonicalRoot(project.path)); } catch { /* Keep lexical protection for stale paths. */ }
    if (candidates.some(candidate => {
      const relative = path.relative(root, candidate);
      return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    })) throw new Error("Selected project contains an unselected project; select nested projects too");
  }
}

function assertSelectedProjects(db: Database, userId: string, grants: McpAllowedProject[], resources?: CommandResources): void {
  if (!resources) return;
  const projects = new ProjectRepository(db, userId);
  const roots = (resources.projectIds ?? []).map(id => {
    const grant = grants.find(item => item.id === id);
    if (!grant) throw new Error("Project is outside MCP token authorization");
    const project = projects.getById(id);
    if (!project) throw new Error("Selected project not found");
    const root = validateMcpAllowedRoot(project.path);
    if (root !== grant.root) throw new Error("MCP authorized project directory has changed");
    assertNoForeignProjectOverlap(db, userId, root);
    assertNoUnselectedNestedProject(db, userId, grants, root);
    return root;
  });
  for (const candidate of resources.rootPaths ?? []) {
    // Bind runtime directories to the resource's project IDs, not any granted project.
    const resolved = canonicalRoot(candidate);
    if (roots.length === 0 || !roots.every(root => root === resolved)) {
      throw new Error("MCP runtime directory does not match its authorized project");
    }
    assertNoForeignProjectOverlap(db, userId, resolved);
  }
}

export function assertMcpTokenAuthority(db: Database, userId: string, tokenId: string, resources?: CommandResources): void {
  const token = new McpTokenRepository(db).findActiveById(tokenId, userId);
  if (!token) throw new Error("MCP token expired or revoked");
  const user = db.prepare("SELECT status FROM users WHERE id = ?").get(userId) as { status: string } | undefined;
  if (user?.status !== "active") throw new Error("MCP owner is inactive");
  const selected = parseMcpAllowedProjects(token.allowedProjects);
  if (selected !== null) {
    assertSelectedProjects(db, userId, selected, resources);
    return;
  }
  if (!parseMcpTokenScopes(token.scopes).includes("cli_dispatch")) return;
  if (!token.allowedRoot || !token.expiresAt) throw new Error("MCP CLI authorization is incomplete");
  const root = validateMcpAllowedRoot(token.allowedRoot);
  if (root !== token.allowedRoot) throw new Error("MCP allowed root has changed");
  for (const projectId of resources?.projectIds ?? []) {
    const project = new ProjectRepository(db, userId).getById(projectId);
    if (!project) throw new Error("Project not found");
    assertWithinRoot(project.path, root);
    assertNoForeignProjectOverlap(db, userId, project.path);
  }
  for (const projectRoot of resources?.rootPaths ?? []) {
    assertWithinRoot(projectRoot, root);
    assertNoForeignProjectOverlap(db, userId, projectRoot);
  }
}
