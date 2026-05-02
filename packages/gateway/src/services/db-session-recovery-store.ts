import type { LaunchPlan } from "../adapters/claude.js";
import type { CredentialMode } from "../config-generation/types.js";
import type { Database } from "../db/types.js";
import type { SessionRecoveryStore, StoredSession } from "./session-manager.js";

interface SessionRecoveryRow {
  id: string;
  user_id: string;
  attach_token: string | null;
  tmux_session: string;
  ai_tool: string;
  working_dir: string;
  credential_mode: string;
  created_at: number | string | null;
}

export function createDbSessionRecoveryStore(db: Database): SessionRecoveryStore {
  return new DbSessionRecoveryStore(db);
}

class DbSessionRecoveryStore implements SessionRecoveryStore {
  constructor(private readonly db: Database) {}

  async listSessions(): Promise<StoredSession[]> {
    const rows = this.db
      .prepare(
        `SELECT id, user_id, attach_token, tmux_session, ai_tool, working_dir, credential_mode, created_at
         FROM sessions
         WHERE tmux_session IS NOT NULL AND tmux_session <> ''`
      )
      .all() as SessionRecoveryRow[];

    return rows.map((row) => {
      const session: StoredSession = {
        id: row.id,
        userId: row.user_id,
        tmuxName: row.tmux_session,
        launchPlan: buildRecoveredLaunchPlan(row),
        createdAt: toIsoString(row.created_at)
      };
      if (row.attach_token) {
        session.attachToken = row.attach_token;
      }
      return session;
    });
  }

  async upsertSession(session: StoredSession): Promise<void> {
    this.db
      .prepare(
        `UPDATE sessions
         SET attach_token = ?, tmux_session = ?, status = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
      .run(
        session.attachToken ?? "",
        session.tmuxName,
        "running",
        Date.now(),
        session.id,
        session.userId
      );
  }

  async removeSession(id: string): Promise<void> {
    this.db
      .prepare(
        `UPDATE sessions
         SET tmux_session = NULL, status = ?, updated_at = ?
         WHERE id = ?`
      )
      .run("exited", Date.now(), id);
  }
}

function buildRecoveredLaunchPlan(row: SessionRecoveryRow): LaunchPlan {
  const credentialMode = parseCredentialMode(row.credential_mode);
  return {
    command: row.ai_tool === "claude" ? "claude" : row.ai_tool,
    args: [],
    cwd: row.working_dir,
    env: { OPENFORGE_SESSION_ID: row.id },
    secretEnvNames: [],
    credentialMode
  };
}

function parseCredentialMode(value: string): CredentialMode {
  return value === "stored_encrypted_key" ? "stored_encrypted_key" : "host_environment";
}

function toIsoString(value: number | string | null): string {
  if (typeof value === "number") {
    return new Date(value).toISOString();
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }
  return new Date().toISOString();
}
