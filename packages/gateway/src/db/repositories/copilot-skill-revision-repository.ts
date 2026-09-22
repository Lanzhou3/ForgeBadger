import { createHash, randomUUID } from 'node:crypto';
import type { Database } from '../types.js';

export interface CopilotSkillFile { path: string; content: string; }
export interface CopilotSkillSource { kind: 'builtin' | 'paste' | 'upload' | 'url' | 'legacy'; url?: string | undefined; label?: string | undefined; }
export interface CopilotSkillSnapshot {
  name: string; description: string; version: string; content: string;
  files: CopilotSkillFile[]; source: CopilotSkillSource; requiredTools: string[]; incompatibilityReasons: string[];
}
export type RevisionAction = 'import' | 'update' | 'rollback' | 'legacy' | 'builtin-update';
export interface SkillRevisionRecord {
  id: string; user_id: string; skill_id: string; parent_revision_id: string | null;
  action: RevisionAction; snapshot_json: string; package_digest: string; created_at: number;
}
export interface SkillHead { skill_id: string; user_id: string; origin_kind: 'builtin' | 'external' | 'legacy'; current_revision_id: string; }

/** The acting owner is bound at construction; no caller-supplied owner reaches a query. */
export class CopilotSkillRevisionRepository {
  constructor(private db: Database, private userId: string) {}
  head(skillId: string): SkillHead | undefined {
    return this.db.prepare('SELECT * FROM copilot_skill_heads WHERE user_id=? AND skill_id=?').get(this.userId, skillId) as SkillHead | undefined;
  }
  get(skillId: string, revisionId: string): SkillRevisionRecord | undefined {
    return this.db.prepare('SELECT * FROM copilot_skill_revisions WHERE user_id=? AND skill_id=? AND id=?').get(this.userId, skillId, revisionId) as SkillRevisionRecord | undefined;
  }
  list(skillId: string): SkillRevisionRecord[] {
    return this.db.prepare('SELECT * FROM copilot_skill_revisions WHERE user_id=? AND skill_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').all(this.userId, skillId) as SkillRevisionRecord[];
  }
  initialize(skillId: string, origin: SkillHead['origin_kind'], snapshot: CopilotSkillSnapshot): SkillRevisionRecord {
    return this.db.transaction(() => {
      const head = this.head(skillId);
      if (head) return this.get(skillId, head.current_revision_id)!;
      const revision = this.insert(skillId, null, origin === 'external' ? 'import' : 'legacy', snapshot);
      this.db.prepare('INSERT INTO copilot_skill_heads(skill_id,user_id,origin_kind,current_revision_id) VALUES (?,?,?,?)')
        .run(skillId, this.userId, origin, revision.id);
      return revision;
    })();
  }
  append(skillId: string, expectedRevisionId: string, action: RevisionAction, snapshot: CopilotSkillSnapshot): SkillRevisionRecord {
    return this.db.transaction(() => {
      const head = this.head(skillId);
      if (!head || head.current_revision_id !== expectedRevisionId) throw new Error('Skill revision changed; reload before saving');
      const revision = this.insert(skillId, expectedRevisionId, action, snapshot);
      const result = this.db.prepare('UPDATE copilot_skill_heads SET current_revision_id=? WHERE user_id=? AND skill_id=? AND current_revision_id=?')
        .run(revision.id, this.userId, skillId, expectedRevisionId);
      if (result.changes !== 1) throw new Error('Skill revision changed; reload before saving');
      return revision;
    })();
  }
  private insert(skillId: string, parent: string | null, action: RevisionAction, snapshot: CopilotSkillSnapshot): SkillRevisionRecord {
    const id = randomUUID();
    const serialized = JSON.stringify(snapshot);
    this.db.prepare('INSERT INTO copilot_skill_revisions(id,user_id,skill_id,parent_revision_id,action,snapshot_json,package_digest,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, this.userId, skillId, parent, action, serialized, createHash('sha256').update(serialized).digest('hex'), Date.now());
    return this.get(skillId, id)!;
  }
}
