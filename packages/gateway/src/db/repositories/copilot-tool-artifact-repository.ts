import { assertGitRoot } from '../../services/development/project-diff.js';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { z } from 'zod';
import type { Database } from '../types.js';
import { encryptSecret, decryptSecret } from '../../crypto/secret-box.js';
import { ProjectRepository } from './project-repository.js';
import type { ToolResultSource } from './copilot-tool-result-repository.js';
import { sourcePath } from '../../services/development/workspace.js';
import { validateProjectRoot } from '../../lib/safe-resolve.js';
import { redactAgentValue } from '../../services/agent/redaction.js';
import { ARCHIVABLE_TOOLS, FILE_ARTIFACT_TOOLS, MAX_ARTIFACT_BYTES, MAX_RUN_ARTIFACT_BYTES, MAX_USER_ARTIFACT_BYTES, ARTIFACT_RETENTION_MS } from '../../services/agent/tool-artifact-policy.js';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const payloadSchema = z.object({ userId: z.string(), conversationId: z.string(), runId: z.string(), stepId: z.string(),
  toolName: z.string(), inputDigest: z.string(), projectPath: z.string().nullable(), canonicalRoot: z.string().nullable(), content: z.string() }).strict();
export interface ArtifactManifest { status: 'available' | 'too_large' | 'quota' | 'unavailable'; bytes?: number; sha256?: string; expiresAt?: number }
interface Identity { conversationId: string; runId: string; stepId: string; toolName: string; inputJson: string }
interface ArtifactRow { payload_json: string; content_bytes: number; content_sha256: string; expires_at: number }

/** Full redacted snapshots are private; callers must first authorize the original message/receipt chain. */
export class CopilotToolArtifactRepository {
  constructor(private db: Database, private userId: string, private masterKey: string) {}

  store(identity: Identity, content: string): ArtifactManifest {
    if (!ARCHIVABLE_TOOLS.has(identity.toolName)) return { status: 'unavailable' };
    const redacted = JSON.stringify(redactAgentValue(JSON.parse(content)));
    const bytes = Buffer.byteLength(redacted);
    if (bytes > MAX_ARTIFACT_BYTES) return { status: 'too_large', bytes };
    return this.db.transaction(() => {
      const current = this.db.prepare(`SELECT 1 FROM copilot_run_steps s JOIN copilot_runs r ON r.user_id=s.user_id AND r.id=s.run_id
        WHERE s.user_id=? AND s.run_id=? AND s.id=? AND r.conversation_id=? AND s.tool_name=? AND s.input_json=?
        AND s.kind='tool' AND s.effect='read' AND s.status='running' AND r.status='running' AND s.fence=r.fence AND r.lease_expires_at>?`)
        .get(this.userId, identity.runId, identity.stepId, identity.conversationId, identity.toolName, identity.inputJson, Date.now());
      if (!current) return { status: 'unavailable' as const };
      this.cleanup();
      // Expired bytes count until deleted, so physical retained content remains bounded.
      const quota = this.db.prepare(`SELECT COALESCE(SUM(content_bytes),0) AS total,
        COALESCE(SUM(CASE WHEN run_id=? THEN content_bytes ELSE 0 END),0) AS run FROM copilot_tool_artifacts WHERE user_id=?`)
        .get(identity.runId, this.userId) as { total: number; run: number };
      if (quota.total + bytes > MAX_USER_ARTIFACT_BYTES || quota.run + bytes > MAX_RUN_ARTIFACT_BYTES) return { status: 'quota' as const, bytes };
      const raw = JSON.parse(identity.inputJson) as { projectId?: string };
      const project = raw.projectId ? new ProjectRepository(this.db, this.userId).getById(raw.projectId) : undefined;
      if (!project) return { status: 'unavailable' as const };
      const canonicalRoot = project && FILE_ARTIFACT_TOOLS.has(identity.toolName) ? realpathSync(project.path) : null;
      const payload = { userId: this.userId, ...identity, inputDigest: digest(identity.inputJson), projectPath: project?.path ?? null, canonicalRoot, content: redacted };
      const { inputJson: _inputJson, ...stored } = payload;
      const expiresAt = Date.now() + ARTIFACT_RETENTION_MS;
      this.db.prepare('INSERT INTO copilot_tool_artifacts(step_id,user_id,run_id,conversation_id,payload_json,content_bytes,content_sha256,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(identity.stepId, this.userId, identity.runId, identity.conversationId, JSON.stringify(encryptSecret(JSON.stringify(stored), { key: this.masterKey })), bytes, digest(redacted), Date.now(), expiresAt);
      return { status: 'available' as const, bytes, sha256: digest(redacted), expiresAt };
    })();
  }

  read(conversationId: string, source: ToolResultSource): { content?: string; status: string } {
    if (!ARCHIVABLE_TOOLS.has(source.toolName)) throw new Error('COPILOT_TOOL_RESULT_UNAVAILABLE');
    const row = this.db.prepare('SELECT payload_json,content_bytes,content_sha256,expires_at FROM copilot_tool_artifacts WHERE user_id=? AND conversation_id=? AND run_id=? AND step_id=?')
      .get(this.userId, conversationId, source.runId, source.stepId) as ArtifactRow | undefined;
    if (!row) return { status: 'missing' };
    if (row.expires_at <= Date.now()) return { status: 'expired' };
    try {
      const payload = payloadSchema.parse(JSON.parse(decryptSecret(JSON.parse(row.payload_json), { key: this.masterKey })));
      if (payload.userId !== this.userId || payload.conversationId !== conversationId || payload.runId !== source.runId
        || payload.stepId !== source.stepId || payload.toolName !== source.toolName || payload.inputDigest !== digest(source.inputJson)
        || Buffer.byteLength(payload.content) !== row.content_bytes || digest(payload.content) !== row.content_sha256) throw new Error('identity');
      this.validateScope(source, payload);
      return { content: payload.content, status: 'available' };
    } catch { throw new Error('COPILOT_TOOL_RESULT_UNAVAILABLE'); }
  }

  cleanup(): void {
    this.db.prepare('DELETE FROM copilot_tool_artifacts WHERE user_id=? AND step_id IN (SELECT step_id FROM copilot_tool_artifacts WHERE user_id=? AND expires_at<=? ORDER BY expires_at LIMIT 100)')
      .run(this.userId, this.userId, Date.now());
  }

  private validateScope(source: ToolResultSource, payload: z.infer<typeof payloadSchema>): void {
    const raw = JSON.parse(source.inputJson) as { projectId?: string; path?: string };
    const project = raw.projectId ? new ProjectRepository(this.db, this.userId).getById(raw.projectId) : undefined;
    if (!project || project.path !== payload.projectPath) throw new Error('scope');
    if (!FILE_ARTIFACT_TOOLS.has(source.toolName)) return;
    if (!project || realpathSync(project.path) !== payload.canonicalRoot) throw new Error('root');
    validateProjectRoot(payload.canonicalRoot!);
    if (source.toolName === 'read_project_diff') assertGitRoot(payload.canonicalRoot!);
    const output = JSON.parse(payload.content) as { path?: string; files?: Array<string | { path: string }>; matches?: Array<{ path: string }> };
    const paths = [raw.path, output.path, ...(output.files ?? []).map(file => typeof file === 'string' ? file : file.path), ...(output.matches ?? []).map(match => match.path)];
    for (const path of paths) if (path) sourcePath(project.path, path, false);
  }
}
