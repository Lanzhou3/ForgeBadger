import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { validateProjectRoot } from "../../lib/safe-resolve.js";
import type { Database } from "../types.js";

/** Narrow cross-tenant exception: detect conflicting host-path claims for usage
 * attribution only. Other tenants' paths and identities never leave this class. */
export class UsageOwnershipRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}

  snapshot(): { roots: string[]; fingerprint: string } {
    const rows = this.db.prepare(`
      SELECT p.id, p.user_id AS userId, p.path, p.status, u.status AS userStatus
      FROM projects p JOIN users u ON u.id = p.user_id
    `).all() as Array<{ id: string; userId: string; path: string; status: string; userStatus: string }>;
    const claims = new Map<string, Set<string>>();
    const candidates = new Set<string>();
    const identities: string[] = [];
    for (const row of rows) {
      const canonical = canonicalDirectory(row.path);
      if (!canonical) continue;
      const owners = claims.get(canonical) ?? new Set<string>();
      owners.add(row.userId);
      claims.set(canonical, owners);
      if (row.userId === this.userId && row.status === "active" && row.userStatus === "active" && row.path === canonical) {
        candidates.add(canonical);
        identities.push(`${row.id}:${canonical}`);
      }
    }
    const roots = [...candidates].filter((root) => claims.get(root)?.size === 1).sort();
    const fingerprint = createHash("sha256").update(JSON.stringify([roots, identities.sort()])).digest("hex");
    return { roots, fingerprint };
  }
}

function canonicalDirectory(value: string): string | null {
  if (!isAbsolute(value)) return null;
  try {
    const canonical = validateProjectRoot(value);
    return statSync(canonical).isDirectory() ? canonical : null;
  } catch {
    return null;
  }
}
