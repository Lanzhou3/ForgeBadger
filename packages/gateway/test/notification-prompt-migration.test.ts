import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { SessionRepository } from '../src/db/repositories/session-repository.js';
import { SessionNotificationPromptRepository } from '../src/db/repositories/session-notification-prompt-repository.js';

it('upgrades existing sessions without inventing native associations and can migrate twice', () => {
  const root = fileURLToPath(new URL('../src/db/migrations', import.meta.url));
  const temporary = mkdtempSync(join(tmpdir(), 'fb-prompt-migration-'));
  const old = join(temporary, 'old'); cpSync(root, old, { recursive: true });
  const journalPath = join(old, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: Array<{ tag: string }> };
  const next = journal.entries.findIndex(entry => entry.tag === '0121_session_notification_prompts');
  assert.ok(next > 0); journal.entries = journal.entries.slice(0, next);
  writeFileSync(journalPath, JSON.stringify(journal));
  const db = new Sqlite(':memory:'); db.pragma('foreign_keys = ON');
  try {
    migrate(drizzle(db), { migrationsFolder: old });
    const user = new UserRepository(db).create('upgrade@test.dev', 'hash');
    const project = new ProjectRepository(db, user.id).create({ name: 'Project', path: temporary, aiTool: 'claude' });
    // Seed the historical schema directly: today's repository includes columns
    // that intentionally do not exist until later migrations have run.
    const session = { id: randomUUID() };
    db.prepare('INSERT INTO sessions(id,user_id,project_id,name,working_dir,ai_tool,last_prompt) VALUES(?,?,?,?,?,?,?)')
      .run(session.id, user.id, project.id, 'Original session', temporary, 'claude', 'Old request without native identity');
    migrate(drizzle(db), { migrationsFolder: root });
    migrate(drizzle(db), { migrationsFolder: root });
    const sessions = new SessionRepository(db, user.id);
    assert.equal(sessions.getById(session.id)?.name, 'Original session');
    assert.equal(sessions.getById(session.id)?.lastPrompt, 'Old request without native identity');
    assert.equal(sessions.getById(session.id)?.nativeSessionId, null);
    const prompts = new SessionNotificationPromptRepository(db, user.id);
    assert.equal(prompts.find(session.id, { sessionId: 'unknown-native' }), undefined);
    prompts.save(session.id, { sessionId: 'known-native' }, 'Fresh request');
    assert.equal(prompts.find(session.id, { sessionId: 'known-native' }), 'Fresh request');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally { db.close(); rmSync(temporary, { recursive: true, force: true }); }
});
