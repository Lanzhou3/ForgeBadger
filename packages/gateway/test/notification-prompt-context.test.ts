import assert from 'node:assert/strict';
import { it } from 'node:test';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { SessionRepository } from '../src/db/repositories/session-repository.js';
import { NotificationRepository } from '../src/db/repositories/notification-repository.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { attachNotificationPersistence } from '../src/services/notification-events.js';
import { handleClaudeNotificationHook } from '../src/routes/session-hooks.js';
import { createNotificationDeduper } from '../src/services/notification-dedupe.js';

it('snapshots a bounded redacted recent user prompt without generating a notification for prompt submission', () => {
  const db = new Sqlite(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  try {
    const user = new UserRepository(db).create('prompt@test.dev', 'hash');
    const project = new ProjectRepository(db, user.id).create({ name: 'Project', path: '/tmp/notification-prompt', aiTool: 'codex' });
    const sessions = new SessionRepository(db, user.id);
    const session = sessions.create({ projectId: project.id, name: 'Project', aiTool: 'codex', workingDir: project.path, attachToken: 'fixture' });
    const bus = new ForgeBadgerEventBus(); attachNotificationPersistence({ db, eventBus: bus });
    const notices = new NotificationRepository(db, user.id);
    const hook = (event: Record<string, unknown>, token = 'fixture') => handleClaudeNotificationHook(db, bus,
      { session_id: 'native-session', turn_id: 'round-1', ...event, adapter: 'codex' }, token, session.id, createNotificationDeduper());
    assert.equal(hook({ hook_event_name: 'UserPromptSubmit', prompt: 'unauthorized' }, 'wrong').status, 401);
    assert.equal(sessions.getById(session.id)?.lastPrompt, null);
    hook({ hook_event_name: 'UserPromptSubmit', prompt: '检查远程通知 sk-SECRET123456789 ' + '甲'.repeat(1500) });
    assert.equal(notices.list().length, 0);
    assert.match(sessions.getById(session.id)!.lastPrompt!, /检查远程通知 \[REDACTED\]/);
    assert.ok(sessions.getById(session.id)!.lastPrompt!.length <= 600);
    hook({ hook_event_name: 'Stop' });
    const saved = notices.list()[0]!;
    assert.match(JSON.parse(saved.payload!).last_prompt, /检查远程通知/);
    hook({ hook_event_name: 'UserPromptSubmit', turn_id: 'round-2', prompt: '第二个请求' });
    assert.equal(notices.get(saved.id)?.payload, saved.payload);
    hook({ hook_event_name: 'UserPromptSubmit', agent_id: 'child', prompt: '子代理内部指令' });
    assert.equal(sessions.getById(session.id)?.lastPrompt, '第二个请求');
  } finally { db.close(); }
});
