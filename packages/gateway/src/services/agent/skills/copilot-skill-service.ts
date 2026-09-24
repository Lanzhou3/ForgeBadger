import { UserRepository } from '../../../db/repositories/user-repository.js';
import type { Database } from '../../../db/types.js';
import { SkillRepository, type Skill } from '../../../db/repositories/skill-repository.js';
import { CopilotSkillRevisionRepository, type CopilotSkillFile, type CopilotSkillSnapshot, type CopilotSkillSource, type SkillRevisionRecord, type SkillHead } from '../../../db/repositories/copilot-skill-revision-repository.js';
import { BUILTIN_COPILOT_SKILLS, getCopilotSkill } from './copilot-skills.js';
import { LEGACY_COPILOT_SKILLS } from './legacy-copilot-skills.js';
import { packageMainFile, parseCopilotSkillPackage, validateSkillFilePath } from './copilot-skill-package.js';

export const MAX_IMPORTED_COPILOT_SKILLS = 32;

export interface CopilotSkillQueryOptions { availableToolNames?: readonly string[]; }
export interface CopilotSkillRow {
  id: string; name: string; description: string; kind: 'builtin-playbook' | 'imported';
  version: string; currentVersion: string; revisionId: string; source: CopilotSkillSource;
  isEnabled: boolean; available: boolean; unavailableReason: string | null;
  compatible: boolean; incompatibilityReasons: string[]; requiredTools: string[];
  reviewRequired: boolean; editable: boolean; updatedAt: string;
}
export interface CopilotSkillDetail extends CopilotSkillRow { content: string; files: CopilotSkillFile[]; }
export interface CopilotSkillUpdate { expectedRevisionId: string; files: CopilotSkillFile[]; reviewedVersion?: string | undefined; }

/** Owns imports, immutable history and compatibility for both current and legacy API surfaces. */
export class CopilotSkillService {
  private skills: SkillRepository;
  private history: CopilotSkillRevisionRepository;
  constructor(private db: Database, private userId: string) {
    this.skills = new SkillRepository(db, userId, 'copilot');
    this.history = new CopilotSkillRevisionRepository(db, userId);
  }
  list(options: CopilotSkillQueryOptions = {}): CopilotSkillRow[] {
    return this.details(options).map(({ content: _content, files: _files, ...row }) => row);
  }
  details(options: CopilotSkillQueryOptions = {}): CopilotSkillDetail[] {
    this.prepare();
    return this.skills.list().map(row => this.describe(row, options));
  }
  get(id: string, options: CopilotSkillQueryOptions = {}): CopilotSkillDetail | undefined {
    this.prepare();
    const row = this.skills.getById(id);
    return row ? this.describe(row, options) : undefined;
  }
  importFiles(source: CopilotSkillSource, files: CopilotSkillFile[], options: CopilotSkillQueryOptions = {}): CopilotSkillDetail {
    if (!['paste', 'upload', 'url'].includes(source.kind)) throw new Error('Invalid imported Skill source');
    const snapshot = parseCopilotSkillPackage(files, source);
    if (getCopilotSkill(snapshot.name)) throw new Error('Builtin Skill names are reserved');
    this.prepare();
    return this.db.transaction(() => {
      if (this.skills.getByName(snapshot.name)) throw new Error('Skill name already exists');
      const importedCount = this.skills.listOwned().filter(row => this.history.head(row.id)?.origin_kind !== 'builtin').length;
      if (importedCount >= MAX_IMPORTED_COPILOT_SKILLS) throw new Error('Installed Copilot Skill package limit reached (32)');
      const row = this.skills.create({ name: snapshot.name, description: snapshot.description, content: snapshot.content,
        version: snapshot.version, source: 'copilot-import', visibility: 'private', isEnabled: false });
      this.history.initialize(row.id, 'external', snapshot);
      return this.describe(row, options);
    })();
  }
  update(id: string, input: CopilotSkillUpdate, options: CopilotSkillQueryOptions = {}): CopilotSkillDetail {
    this.prepare();
    return this.db.transaction(() => {
      const { row, head, snapshot } = this.owned(id, input.expectedRevisionId);
      let next = parseCopilotSkillPackage(input.files, snapshot.source);
      const builtin = head.origin_kind === 'builtin' ? getCopilotSkill(row.name) : undefined;
      if (builtin) {
        if (next.name !== builtin.name) throw new Error('Builtin Skill name cannot change');
        if (row.version !== builtin.version && input.reviewedVersion !== builtin.version) throw new Error('Review the current builtin Skill version before saving');
        if (input.reviewedVersion && input.reviewedVersion !== builtin.version) throw new Error('Builtin Skill version changed; reload before saving');
        next = { ...next, version: builtin.version, requiredTools: [...builtin.requiredTools] };
        next.files = next.files.map(file => file.path === 'SKILL.md' ? packageMainFile(next.name, next.description, next.version, next.content) : file);
      } else if (getCopilotSkill(next.name)) throw new Error('Builtin Skill names are reserved');
      this.commit(row, head.current_revision_id, 'update', next);
      return this.describe(this.skills.getById(id)!, options);
    })();
  }
  setEnabled(id: string, enabled: boolean, expectedRevisionId: string, options: CopilotSkillQueryOptions = {}): CopilotSkillDetail {
    this.prepare();
    return this.db.transaction(() => {
      const { row } = this.owned(id, expectedRevisionId);
      const current = this.describe(row, options);
      if (enabled && (!current.compatible || current.reviewRequired)) throw new Error('Skill is incompatible or requires version review');
      const changed = this.skills.toggle(id, enabled)!;
      return this.describe(changed, options);
    })();
  }
  rollback(id: string, revisionId: string, expectedRevisionId: string, options: CopilotSkillQueryOptions = {}): CopilotSkillDetail {
    this.prepare();
    return this.db.transaction(() => {
      const { row } = this.owned(id, expectedRevisionId);
      const target = this.history.get(id, revisionId);
      if (!target) throw new Error('Skill revision not found');
      this.commit(row, expectedRevisionId, 'rollback', JSON.parse(target.snapshot_json) as CopilotSkillSnapshot);
      return this.describe(this.skills.getById(id)!, options);
    })();
  }
  revisions(id: string) {
    this.prepare(); this.owned(id);
    return this.history.list(id).map(revisionSummary);
  }
  revision(id: string, revisionId: string) {
    this.prepare(); this.owned(id);
    const record = this.history.get(id, revisionId);
    return record ? { ...revisionSummary(record), files: (JSON.parse(record.snapshot_json) as CopilotSkillSnapshot).files } : undefined;
  }
  readResource(input: { skillId: string; revisionId: string; relativePath: string; offset?: number | undefined; length?: number | undefined }, options: CopilotSkillQueryOptions = {}) {
    validateSkillFilePath(input.relativePath);
    const skill = this.get(input.skillId, options);
    if (!skill?.available || skill.revisionId !== input.revisionId) return { found: false as const };
    const file = skill.files.find(item => item.path === input.relativePath);
    if (!file) return { found: false as const };
    const offset = Math.max(0, input.offset ?? 0); const length = Math.min(12_000, Math.max(1, input.length ?? 12_000));
    return { found: true as const, skillId: skill.id, revisionId: skill.revisionId, relativePath: file.path,
      content: file.content.slice(offset, offset + length), offset, totalCharacters: file.content.length,
      nextOffset: offset + length < file.content.length ? offset + length : null };
  }
  /** Legacy clients keep their body/version contract while history remains append-only. */
  updateLegacy(id: string, content: string, version: string, options: CopilotSkillQueryOptions = {}) {
    const current = this.get(id, options);
    if (!current?.editable) throw new Error('Skill not found');
    const builtin = getCopilotSkill(current.name);
    if (current.kind !== 'builtin-playbook' || !builtin || version !== builtin.version) throw new Error('Review and save against the current bundled playbook version');
    return this.update(id, { expectedRevisionId: current.revisionId, reviewedVersion: version,
      files: current.files.map(file => file.path === 'SKILL.md' ? packageMainFile(current.name, current.description, version, content) : file) }, options);
  }
  private prepare(): void {
    if (new UserRepository(this.db).findById(this.userId)?.status !== 'active') throw new Error('Skill owner is inactive');
    this.db.transaction(() => {
      const initial = new Set(this.skills.listOwned().filter(row => !this.history.head(row.id)).map(row => row.id));
      for (const row of this.skills.listOwned()) this.capture(row);
      for (const builtin of BUILTIN_COPILOT_SKILLS) {
        const row = this.skills.getByName(builtin.name);
        if (!row) {
          this.skills.create({name:builtin.name,description:builtin.description,content:builtin.body,version:builtin.version,source:'builtin'});
          continue;
        }
        const legacy = LEGACY_COPILOT_SKILLS.find(item => item.name === builtin.name);
        if (initial.has(row.id) && row.source === 'builtin' && row.version === '1.0.0' && legacy &&
          row.content === legacy.body && row.description === legacy.description) {
          this.skills.update(row.id,{content:builtin.body,description:builtin.description,version:builtin.version});
        }
      }
      for (const row of this.skills.listOwned()) this.capture(row);
    })();
  }
  private capture(row: Skill): void {
    const head = this.history.head(row.id);
    if (!head) {
      this.history.initialize(row.id, row.source === 'builtin' && getCopilotSkill(row.name) ? 'builtin' : 'legacy', legacySnapshot(row));
      return;
    }
    const current = JSON.parse(this.history.get(row.id, head.current_revision_id)!.snapshot_json) as CopilotSkillSnapshot;
    if (row.name === current.name && (row.description ?? '') === current.description && row.content === current.content && row.version === current.version) return;
    const updated = { ...legacySnapshot(row), source: current.source };
    this.history.append(row.id, head.current_revision_id, 'builtin-update', updated);
  }
  private owned(id: string, expectedRevisionId?: string) {
    const row = this.skills.getOwnedById(id);
    const head = this.history.head(id);
    if (!row || !head) throw new Error('Skill not found');
    if (expectedRevisionId !== undefined && head.current_revision_id !== expectedRevisionId) throw new Error('Skill revision changed; reload before saving');
    return { row, head, snapshot: JSON.parse(this.history.get(id, head.current_revision_id)!.snapshot_json) as CopilotSkillSnapshot };
  }
  private commit(row: Skill, expected: string, action: 'update' | 'rollback', next: CopilotSkillSnapshot): void {
    const collision = this.skills.getByName(next.name);
    if (collision && collision.id !== row.id) throw new Error('Skill name already exists');
    this.history.append(row.id, expected, action, next);
    this.skills.update(row.id, { name: next.name, description: next.description, content: next.content, version: next.version });
  }
  private describe(row: Skill, options: CopilotSkillQueryOptions): CopilotSkillDetail {
    const head = this.history.head(row.id);
    const record = head ? this.history.get(row.id, head.current_revision_id) : undefined;
    const snapshot = record ? JSON.parse(record.snapshot_json) as CopilotSkillSnapshot : legacySnapshot(row);
    return describeSkill(row, snapshot, head, record, options, this.userId);
  }
}

function legacySnapshot(row: Skill): CopilotSkillSnapshot {
  const builtin = getCopilotSkill(row.name);
  return { name: row.name, description: row.description ?? '', version: row.version, content: row.content,
    files: [packageMainFile(row.name, row.description ?? '', row.version, row.content)],
    source: { kind: row.source === 'builtin' && builtin ? 'builtin' : 'legacy' },
    requiredTools: [...(builtin?.requiredTools ?? [])], incompatibilityReasons: [] };
}
function revisionSummary(record: SkillRevisionRecord) {
  const snapshot = JSON.parse(record.snapshot_json) as CopilotSkillSnapshot;
  return { id: record.id, version: snapshot.version, source: snapshot.source, createdAt: new Date(record.created_at).toISOString(),
    packageDigest: record.package_digest, fileCount: snapshot.files.length, action: record.action };
}
function describeSkill(row: Skill, snapshot: CopilotSkillSnapshot, head: SkillHead | undefined, record: SkillRevisionRecord | undefined, options: CopilotSkillQueryOptions, userId: string): CopilotSkillDetail {
  const bundled = head?.origin_kind === 'builtin' ? getCopilotSkill(row.name) : undefined;
  const trusted = !!bundled && snapshot.version === bundled.version && snapshot.name === bundled.name &&
    snapshot.description === bundled.description && snapshot.content === bundled.body && snapshot.files.length === 1 &&
    snapshot.files[0]?.path === 'SKILL.md' && snapshot.files[0]?.content === packageMainFile(bundled.name,bundled.description,bundled.version,bundled.body).content;
  const reviewRequired = !!bundled && snapshot.version !== bundled.version;
  const missing = snapshot.requiredTools.filter(name => !options.availableToolNames?.includes(name));
  const compatible = snapshot.incompatibilityReasons.length === 0;
  const unavailableReason = !row.isEnabled ? 'disabled_by_owner' : reviewRequired ? 'playbook_review_required'
    : !compatible ? 'incompatible_skill_package'
    : missing.length ? `required_tools_unavailable:${missing.join(',')}` : null;
  return { id: row.id, name: trusted ? bundled!.name : snapshot.name,
    description: trusted ? bundled!.description : snapshot.description,
    kind: bundled ? 'builtin-playbook' : 'imported', version: snapshot.version, currentVersion: bundled?.version ?? snapshot.version,
    revisionId: head?.current_revision_id ?? `legacy:${row.id}`, source: snapshot.source, isEnabled: row.isEnabled,
    available: unavailableReason === null, unavailableReason, compatible, incompatibilityReasons: snapshot.incompatibilityReasons,
    requiredTools: snapshot.requiredTools, reviewRequired, editable: row.userId === userId,
    updatedAt: new Date(record?.created_at ?? row.updatedAt?.getTime() ?? 0).toISOString(),
    content: trusted ? bundled!.body : snapshot.content, files: snapshot.files };
}

/** Lightweight current catalog for the model context; callers supply its effective tools. */
export function listAvailableCopilotSkillSummaries(db: Database, userId: string, options: CopilotSkillQueryOptions = {}) {
  return new CopilotSkillService(db,userId).list(options).filter(row=>row.available)
    .map(({id,revisionId,name,description})=>({id,revisionId,name,description}));
}
