import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { SkillRepository } from '../src/db/repositories/skill-repository.js';
import { CopilotSkillService } from '../src/services/agent/skills/copilot-skill-service.js';
import { CopilotSkillRevisionRepository } from '../src/db/repositories/copilot-skill-revision-repository.js';
import { BUILTIN_COPILOT_SKILLS, getCopilotSkill, type CopilotSkill } from '../src/services/agent/skills/copilot-skills.js';
import { packageMainFile } from '../src/services/agent/skills/copilot-skill-package.js';
import { seedBuiltinCopilotPlaybooks } from '../src/services/builtin-skills.js';
import { isUnmodifiedBuiltin } from '../src/services/agent/skills/copilot-skill-baselines.js';
const old = JSON.parse(readFileSync(new URL('./fixtures/copilot-session-dispatch-v2.json', import.meta.url), 'utf8')) as CopilotSkill;
const bundled = getCopilotSkill(old.name)!;
const options = { availableToolNames: [...bundled.requiredTools] };
function fixture(content = old.body, enabled = true) {
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: new URL('../src/db/migrations/', import.meta.url).pathname });
  const user = new UserRepository(db).create('upgrade@test.dev', 'hash');
  const repo = new SkillRepository(db, user.id, 'copilot');
  const row = repo.create({ name: old.name, description: old.description, content, version: old.version, source: 'builtin', isEnabled: enabled });
  return { db, user, repo, row, service: new CopilotSkillService(db, user.id) };
}
it('upgrades known untouched v2 even with existing history, preserving disabled choice and rollback across seeding', () => {
  const f = fixture(old.body, false);
  try {
    const history = new CopilotSkillRevisionRepository(f.db, f.user.id);
    const initial = history.initialize(f.row.id, 'builtin', { name: old.name, description: old.description, content: old.body, version: old.version,
      source: { kind: 'builtin' }, requiredTools: [...old.requiredTools], incompatibilityReasons: [], files: [packageMainFile(old.name, old.description, old.version, old.body)] });
    const upgraded = f.service.get(f.row.id, options)!;
    assert.equal(upgraded.version, bundled.version);
    assert.equal(upgraded.content, bundled.body);
    assert.equal(upgraded.isEnabled, false);
    assert.equal(upgraded.reviewRequired, false);
    assert.equal(f.service.revisions(f.row.id).length, 2);
    assert.equal(f.service.get(f.row.id)!.revisionId, upgraded.revisionId);
    const restored = f.service.rollback(f.row.id, initial.id, upgraded.revisionId, options);
    seedBuiltinCopilotPlaybooks(f.repo);
    assert.equal(f.service.get(f.row.id)!.revisionId, restored.revisionId);
    assert.equal(restored.content, old.body);
    assert.equal(restored.reviewRequired, true);
    assert.equal(restored.customized, false);
  } finally { f.db.close(); }
});
it('saving customized old content does not acknowledge or disguise it as a new builtin', () => {
  const f = fixture(old.body + '\nOwner instructions');
  try {
    const current = f.service.get(f.row.id, options)!;
    const saved = f.service.update(current.id, { expectedRevisionId: current.revisionId, files: current.files }, options);
    assert.equal(saved.version, old.version);
    assert.equal(saved.reviewRequired, true);
    assert.equal(saved.available, false);
    const reviewed = f.service.update(saved.id, { expectedRevisionId: saved.revisionId, files: saved.files, reviewedVersion: bundled.version }, options);
    assert.equal(reviewed.version, old.version);
    assert.equal(reviewed.content, current.content);
    assert.equal(reviewed.reviewRequired, false);
    assert.equal(reviewed.available, true);
  } finally { f.db.close(); }
});
it('adopting replaces the whole package, preserves history and rejects stale versions, revisions and foreign owners', () => {
  const f = fixture(old.body + '\nCustom');
  try {
    const initial = f.service.get(f.row.id, options)!;
    const edited = f.service.update(initial.id, { expectedRevisionId: initial.revisionId, files: [...initial.files, { path: 'references/custom.md', content: 'retain in history' }] }, options);
    assert.throws(() => f.service.adoptBuiltin(edited.id, initial.revisionId, bundled.version), /revision changed/);
    assert.throws(() => f.service.adoptBuiltin(edited.id, edited.revisionId, '0.0.0'), /version changed/);
    const other = new UserRepository(f.db).create('other-upgrade@test.dev', 'hash');
    assert.throws(() => new CopilotSkillService(f.db, other.id).adoptBuiltin(edited.id, edited.revisionId, bundled.version), /not found/);
    const adopted = f.service.adoptBuiltin(edited.id, edited.revisionId, bundled.version, options);
    assert.equal(adopted.version, bundled.version);
    assert.equal(adopted.content, bundled.body);
    assert.equal(adopted.files.length, 1);
    assert.equal(adopted.customized, false);
    assert.equal(adopted.available, true);
    assert.deepEqual(f.service.revision(edited.id, edited.revisionId)!.files, edited.files);
    const rolledBack = f.service.rollback(edited.id, edited.revisionId, adopted.revisionId, options);
    assert.deepEqual(rolledBack.files, edited.files);
    assert.equal(f.service.get(edited.id)!.reviewRequired, true);
  } finally { f.db.close(); }
});
it('neither forged version metadata nor unrecognized packages bypass review, and review survives reopening the service', () => {
  const f = fixture(old.body + '\nCustom');
  try {
    const initial = f.service.get(f.row.id, options)!;
    const forgedFiles = [packageMainFile(old.name, old.description, bundled.version, initial.content)];
    const saved = f.service.update(initial.id, { expectedRevisionId: initial.revisionId, files: forgedFiles }, options);
    assert.equal(saved.reviewRequired, true);
    assert.equal(saved.available, false);
    assert.throws(() => f.service.update(saved.id, { expectedRevisionId: saved.revisionId, files: saved.files, reviewedVersion: '0.0.0' }), /version changed/);
    const reviewed = f.service.update(saved.id, { expectedRevisionId: saved.revisionId, files: saved.files, reviewedVersion: bundled.version }, options);
    assert.equal(reviewed.customized, true);
    assert.equal(reviewed.reviewedBuiltinVersion, bundled.version);
    assert.equal(new CopilotSkillService(f.db, f.user.id).get(saved.id, options)!.available, true);
    assert.equal(f.service.get(saved.id, { availableToolNames: [] })!.available, false);
  } finally { f.db.close(); }
});
it('does not auto-upgrade packages with extra files or explicit user revisions', () => {
  for (const action of ['legacy', 'update'] as const) {
    const f = fixture();
    try {
      const history = new CopilotSkillRevisionRepository(f.db, f.user.id);
      const snapshot = { name: old.name, description: old.description, content: old.body, version: old.version,
        source: { kind: 'builtin' as const }, requiredTools: [...old.requiredTools], incompatibilityReasons: [],
        files: [packageMainFile(old.name, old.description, old.version, old.body)] };
      if (action === 'legacy') snapshot.files.push({ path: 'references/user.md', content: 'preserve me' });
      const initial = history.initialize(f.row.id, 'builtin', snapshot);
      if (action === 'update') history.append(f.row.id, initial.id, action, snapshot);
      const skill = f.service.get(f.row.id)!;
      assert.equal(skill.version, old.version);
      assert.deepEqual(skill.files, snapshot.files);
      assert.equal(skill.reviewRequired, true);
    } finally { f.db.close(); }
  }
});

it('archives current bundle fingerprints so future upgrades can recognize untouched copies', () => {
  for (const skill of BUILTIN_COPILOT_SKILLS) {
    assert.equal(isUnmodifiedBuiltin({ name: skill.name, description: skill.description, version: skill.version, content: skill.body,
      source: { kind: 'builtin' }, requiredTools: [...skill.requiredTools], incompatibilityReasons: [],
      files: [packageMainFile(skill.name, skill.description, skill.version, skill.body)] }), true, `Archive the exact ${skill.name} ${skill.version} fingerprint when changing the bundle`);
  }
});
