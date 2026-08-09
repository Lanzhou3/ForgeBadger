import type { LaunchPlan } from "../adapters/claude.js";
import type { CredentialMode } from "../config-generation/types.js";
import { decryptSecret, encryptSecret } from "../crypto/secret-box.js";
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

const ENCRYPTED_PREFIX = "enc:";

export function createDbSessionRecoveryStore(
  db: Database,
  masterKey?: string
): SessionRecoveryStore {
  return new DbSessionRecoveryStore(db, masterKey);
}

class DbSessionRecoveryStore implements SessionRecoveryStore {
  constructor(
    private readonly db: Database,
    private readonly masterKey?: string
  ) {}

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
      const attachToken = this.decryptAttachToken(row.attach_token);
      if (attachToken) {
        session.attachToken = attachToken;
      }
      return session;
    });
  }

  async upsertSession(session: StoredSession): Promise<void> {
    const storedToken = session.attachToken
      ? this.encryptAttachToken(session.attachToken)
      : "";
    const result = this.db
      .prepare(
        `UPDATE sessions
         SET attach_token = ?, tmux_session = ?, status = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
      .run(
        storedToken,
        session.tmuxName,
        "running",
        Date.now(),
        session.id,
        session.userId
      );
    if (result.changes === 0) {
      // No row to update (e.g. a Gate-A session never created a DB row). A
      // silent no-op would leave the session unrecoverable across restarts, so
      // surface a warning instead.
      console.warn(
        `[db-session-recovery-store] upsertSession matched no row for ${session.id}; session may not survive a restart`
      );
    }
  }

  async removeSession(id: string, userId: string): Promise<void> {
    this.db
      .prepare(
        `UPDATE sessions
         SET tmux_session = NULL, status = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
      .run("exited", Date.now(), id, userId);
  }

  private encryptAttachToken(token: string): string {
    if (!this.masterKey) {
      return token;
    }
    const encrypted = encryptSecret(token, { key: this.masterKey });
    return `${ENCRYPTED_PREFIX}${encrypted.algorithm}.${encrypted.iv}.${encrypted.ciphertext}.${encrypted.authTag}`;
  }

  private decryptAttachToken(stored: string | null): string | undefined {
    if (!stored) {
      return undefined;
    }
    if (!stored.startsWith(ENCRYPTED_PREFIX)) {
      // Legacy plaintext row — keep working, migration re-encrypts on next write.
      return stored;
    }
    if (!this.masterKey) {
      return undefined;
    }
    const body = stored.slice(ENCRYPTED_PREFIX.length);
    const [algorithm, iv, ciphertext, authTag] = body.split(".");
    if (!algorithm || !iv || !ciphertext || !authTag) {
      return undefined;
    }
    try {
      return decryptSecret(
        { algorithm: algorithm as "aes-256-gcm", iv, ciphertext, authTag },
        { key: this.masterKey }
      );
    } catch {
      return undefined;
    }
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
