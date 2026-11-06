import { randomBytes, timingSafeEqual } from "node:crypto";

import { decryptSecret, encryptSecret } from "../../crypto/secret-box.js";
import type { Database } from "../types.js";

export interface ClaudeRouteSettings {
  userId: string;
  enabled: boolean;
  /** Plaintext route token when enabled, null otherwise. */
  token: string | null;
}

export interface ClaudeRouteAssignment {
  userId: string;
  providerProfileId: string;
  credentialId: string;
  /** 1-based priority: 1 is the primary target, later positions are failover candidates. */
  position: number;
  updatedAt: number;
}

interface SettingsRow {
  user_id: string;
  claude_route_enabled: number;
  claude_route_token: string | null;
}

interface AssignmentRow {
  user_id: string;
  provider_profile_id: string;
  credential_id: string;
  position: number;
  updated_at: number;
}

/**
 * Per-user Claude Code routing switch + encrypted loopback token, and the
 * provider/credential assignment the routed endpoint forwards to.
 */
export class ClaudeRouteRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: string,
    private readonly masterKey: string
  ) {}

  getSettings(): ClaudeRouteSettings {
    const row = this.db.prepare(`
      SELECT user_id, claude_route_enabled, claude_route_token
      FROM user_settings
      WHERE user_id = ?
    `).get(this.userId) as SettingsRow | undefined;
    if (!row) {
      return { userId: this.userId, enabled: false, token: null };
    }
    return {
      userId: this.userId,
      enabled: row.claude_route_enabled === 1,
      token: this.decryptToken(row.claude_route_token)
    };
  }

  /** Enables/disables routing; generates the token on first enable. */
  setEnabled(enabled: boolean): ClaudeRouteSettings {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO user_settings (user_id, created_at, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET updated_at = excluded.updated_at
    `).run(this.userId, now, now);
    const current = this.getSettings();
    if (enabled && !current.token) {
      const token = randomBytes(32).toString("hex");
      const encrypted = encryptSecret(token, { key: this.masterKey });
      this.db.prepare(`
        UPDATE user_settings
        SET claude_route_enabled = 1, claude_route_token = ?, updated_at = ?
        WHERE user_id = ?
      `).run(JSON.stringify(encrypted), now, this.userId);
      return { userId: this.userId, enabled: true, token };
    }
    this.db.prepare(`
      UPDATE user_settings
      SET claude_route_enabled = ?, updated_at = ?
      WHERE user_id = ?
    `).run(enabled ? 1 : 0, now, this.userId);
    return { userId: this.userId, enabled, token: current.token };
  }

  listAssignments(): ClaudeRouteAssignment[] {
    const rows = this.db.prepare(`
      SELECT user_id, provider_profile_id, credential_id, position, updated_at
      FROM claude_route_assignments
      WHERE user_id = ?
      ORDER BY position
    `).all(this.userId) as AssignmentRow[];
    return rows.map((row) => ({
      userId: row.user_id,
      providerProfileId: row.provider_profile_id,
      credentialId: row.credential_id,
      position: row.position,
      updatedAt: row.updated_at
    }));
  }

  getAssignment(): ClaudeRouteAssignment | undefined {
    return this.listAssignments()[0];
  }

  /**
   * Pins the provider as the PRIMARY target (position 1), shifting existing
   * candidates down. Used by apply: the most recently applied provider is
   * what Claude Code talks to first. (Rewritten via setOrderedAssignments:
   * an in-place position +1 shift would trip the unique(user, position)
   * constraint mid-statement in SQLite.)
   */
  upsertAssignment(providerProfileId: string, credentialId: string): void {
    const others = this.listAssignments()
      .filter((assignment) => assignment.providerProfileId !== providerProfileId)
      .map((assignment) => ({
        providerProfileId: assignment.providerProfileId,
        credentialId: assignment.credentialId
      }));
    this.setOrderedAssignments([{ providerProfileId, credentialId }, ...others]);
  }

  /**
   * Replaces the whole ordered candidate list (positions renumbered 1..N in
   * the given order). Empty list clears the assignments.
   */
  setOrderedAssignments(entries: Array<{ providerProfileId: string; credentialId: string }>): void {
    const now = Date.now();
    this.db.transaction(() => {
      this.db.prepare(`
        DELETE FROM claude_route_assignments
        WHERE user_id = ?
      `).run(this.userId);
      const insert = this.db.prepare(`
        INSERT INTO claude_route_assignments (user_id, provider_profile_id, credential_id, position, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      entries.forEach((entry, index) => {
        insert.run(this.userId, entry.providerProfileId, entry.credentialId, index + 1, now);
      });
    }).immediate();
  }

  /** Removes a candidate and renumbers the rest to stay contiguous. */
  removeAssignment(providerProfileId: string): void {
    const row = this.db.prepare(`
      SELECT position FROM claude_route_assignments
      WHERE user_id = ? AND provider_profile_id = ?
    `).get(this.userId, providerProfileId) as { position: number } | undefined;
    if (!row) return;
    this.db.transaction(() => {
      this.db.prepare(`
        DELETE FROM claude_route_assignments
        WHERE user_id = ? AND provider_profile_id = ?
      `).run(this.userId, providerProfileId);
      this.db.prepare(`
        UPDATE claude_route_assignments
        SET position = position - 1
        WHERE user_id = ? AND position > ?
      `).run(this.userId, row.position);
    }).immediate();
  }

  clearAssignment(): void {
    this.db.prepare(`
      DELETE FROM claude_route_assignments
      WHERE user_id = ?
    `).run(this.userId);
  }

  /**
   * Resolves the owner of a presented route token (data-plane auth). Scans the
   * small local user set and compares in constant time. Returns the plaintext
   * token for the caller to keep masked.
   */
  static resolveTokenOwner(
    db: Database,
    masterKey: string,
    presented: string | undefined
  ): ClaudeRouteSettings | undefined {
    if (!presented) return undefined;
    const presentedBytes = Buffer.from(presented, "utf8");
    const rows = db.prepare(`
      SELECT user_id, claude_route_enabled, claude_route_token
      FROM user_settings
      WHERE claude_route_token IS NOT NULL
    `).all() as SettingsRow[];
    for (const row of rows) {
      let token: string;
      try {
        token = decryptSecret(JSON.parse(row.claude_route_token ?? "{}"), { key: masterKey });
      } catch {
        continue;
      }
      const tokenBytes = Buffer.from(token, "utf8");
      if (tokenBytes.length === presentedBytes.length && timingSafeEqual(tokenBytes, presentedBytes)) {
        return {
          userId: row.user_id,
          enabled: row.claude_route_enabled === 1,
          token
        };
      }
    }
    return undefined;
  }

  private decryptToken(encryptedJson: string | null): string | null {
    if (!encryptedJson) return null;
    try {
      return decryptSecret(JSON.parse(encryptedJson), { key: this.masterKey });
    } catch {
      return null;
    }
  }
}
