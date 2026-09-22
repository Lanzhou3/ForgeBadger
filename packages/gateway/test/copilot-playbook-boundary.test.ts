import assert from 'node:assert/strict';
import { it } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { SkillRepository } from '../src/db/repositories/skill-repository.js';
import { seedBuiltinSkills } from '../src/services/builtin-skills.js';
import { createSkillTools } from '../src/services/agent/tools/skills.js';

it('keeps Copilot playbooks outside the default CLI skill scope', () => {
 const db = new Database(':memory:');
 try {
  migrate(drizzle(db), {migrationsFolder:new URL('../src/db/migrations/',import.meta.url).pathname});
  const user = new UserRepository(db).create('boundary@test.dev','hash');
  const repo = new SkillRepository(db,user.id);
  seedBuiltinSkills(repo);
  assert.equal(repo.list().some(s=>s.name==='autonomous-work-item-loop'), false);
 } finally { db.close(); }
});
it('retires ambiguous skill tool names',()=>assert.deepEqual(createSkillTools().map(t=>t.name),['list_playbooks','load_playbook','read_skill_resource']));
