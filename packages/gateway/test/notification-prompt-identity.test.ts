import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
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
import { renderFeishuNotificationCard } from '../src/services/notifications/feishu-notification-card.js';
import type { FeishuNotificationDelivery } from '../src/db/repositories/feishu-notification-repository.js';
import { MAX_SESSION_NOTIFICATION_PROMPTS, SessionNotificationPromptRepository } from '../src/db/repositories/session-notification-prompt-repository.js';

function setup(t: TestContext) {
  const db = new Sqlite(':memory:'); t.after(() => db.close()); db.pragma('foreign_keys = ON');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const user = new UserRepository(db).create('identity@test.dev', 'hash');
  const project = new ProjectRepository(db, user.id).create({ name: 'Project', path: '/tmp/notification-identity', aiTool: 'codex' });
  const sessions = new SessionRepository(db, user.id);
  const session = sessions.create({ projectId: project.id, name: 'Named session', aiTool: 'codex', workingDir: project.path, attachToken: 'fixture' });
  const bus = new ForgeBadgerEventBus(); attachNotificationPersistence({ db, eventBus: bus });
  const notices = new NotificationRepository(db, user.id), deduper = createNotificationDeduper();
  const hook = (event: Record<string, unknown>, token = 'fixture') => handleClaudeNotificationHook(db, bus,
    { adapter: 'codex', ...event }, token, session.id, deduper);
  const submit = (prompt: string, native = 'native-A', turn?: string) => hook({ hook_event_name: 'UserPromptSubmit', session_id: native, turn_id: turn, prompt });
  const stop = (native?: unknown, turn?: unknown, extra: Record<string, unknown> = {}) => {
    const prior = new Set(notices.list().map(n => n.id));
    const result = hook({ hook_event_name: 'Stop', session_id: native, turn_id: turn, ...extra });
    assert.equal(result.status, 200);
    const notice = notices.list().find(n => !prior.has(n.id)); assert.ok(notice, 'distinct native turns must not deduplicate each other');
    return notice;
  };
  return { db, user, project, sessions, session, notices, hook, submit, stop };
}
const item: FeishuNotificationDelivery = { id: 'delivery', notification_id: 'notice', test_key: null, event_type: 'completion',
  subscription_revision: 1, identity_revision: 1, target_id: 'private:owner', target_revision: 1,
  status: 'pending', error_code: null, claim_token: null, lease_until: null, attempt_count: 0,
  next_attempt_at: 0, expires_at: 0, created_at: Date.now() };

for (const [name, source, secret] of [
  ['password', 'password=fixture-password', 'fixture-password'],
  ['client secret', 'CLIENT_SECRET=fixture-client-secret', 'fixture-client-secret'],
  ['JSON API key', '{"api_key":"fixture-json-key"}', 'fixture-json-key'],
  ['mixed case', 'Client_Secret: fixture-mixed-secret', 'fixture-mixed-secret'],
  ['quoted password', 'password="fixture quoted password"', 'fixture quoted password'],
  ['truncation boundary', 'x'.repeat(580) + ' password=' + 'fixture-boundary-secret'.repeat(10), 'fixture-boundary'],
  ['multiline', 'check config\nPASSWORD=fixture-multiline\nthen review', 'fixture-multiline'],
] as const) it(`redacts ${name} before persistence and when rendering legacy notifications`, t => {
  const f = setup(t); f.submit(source, 'native-A', 'turn-1');
  assert.equal(f.sessions.getById(f.session.id)!.lastPrompt!.includes(secret), false);
  const stored = f.db.prepare('SELECT prompt FROM session_notification_prompts WHERE user_id=? AND session_id=?')
    .get(f.user.id, f.session.id) as { prompt: string };
  assert.equal(stored.prompt.includes(secret), false);
  const notice = f.stop('native-A', 'turn-1');
  assert.equal(notice.payload!.includes(secret), false);
  const legacy = { ...notice, payload: JSON.stringify({ last_prompt: source, notification_type: 'task_completed' }), message: source };
  const card = JSON.stringify(renderFeishuNotificationCard(item, legacy, ''));
  assert.equal(card.includes(secret), false);
  assert.match(card, /\[REDACTED\]/);
});

it('matches interleaved native sessions and exact turns rather than the shared lastPrompt', t => {
  const f = setup(t);
  f.submit('Task A1', 'native-A', 'turn-1');
  f.submit('Task B1', 'native-B', 'turn-1');
  f.submit('Task A2', 'native-A', 'turn-2');
  assert.equal(JSON.parse(f.stop('native-A', 'turn-1').payload!).last_prompt, 'Task A1');
  assert.equal(JSON.parse(f.stop('native-B', 'turn-1').payload!).last_prompt, 'Task B1');
  assert.equal(JSON.parse(f.stop('native-A', 'turn-2').payload!).last_prompt, 'Task A2');
  assert.equal(JSON.parse(f.stop('native-A', 'missing-turn').payload!).last_prompt, undefined);
});

it('uses same-native Claude no-turn metadata, but never reuses it for an identified unknown turn', t => {
  const f = setup(t);
  f.submit('Claude A request', 'native-A'); f.submit('Claude B request', 'native-B');
  assert.equal(JSON.parse(f.stop('native-A').payload!).last_prompt, 'Claude A request');
  assert.equal(JSON.parse(f.stop('native-A', 'unknown').payload!).last_prompt, undefined);
});

for (const [name, native, turn, extra] of [
  ['legacy', undefined, undefined, {}], ['unknown native', 'unknown', undefined, {}],
  ['invalid native', { id: 'native-A' }, undefined, {}], ['invalid turn', 'native-A', 123, {}],
  ['oversized ID', 'x'.repeat(300), undefined, {}],
] as const) it(`keeps the lifecycle notification but falls back to session name for ${name}`, t => {
  const f = setup(t); f.submit('Do not attribute this request');
  const notice = f.stop(native, turn, extra);
  assert.equal(JSON.parse(notice.payload!).last_prompt, undefined);
  const card = JSON.stringify(renderFeishuNotificationCard(item, notice, ''));
  assert.match(card, /Named session/); assert.doesNotMatch(card, /Do not attribute/);
});

it('isolates identical native IDs by tenant and ForgeBadger session, and cleans up with session deletion', t => {
  const f = setup(t);
  f.submit('Owner request', 'shared-native', 'same-turn');
  const owner = new SessionNotificationPromptRepository(f.db, f.user.id);
  const other = new UserRepository(f.db).create('other-identity@test.dev', 'hash');
  const project = new ProjectRepository(f.db, other.id).create({ name: 'Other', path: '/tmp/other-notification-identity', aiTool: 'codex' });
  const session = new SessionRepository(f.db, other.id).create({ projectId: project.id, name: 'Other', aiTool: 'codex', workingDir: project.path });
  const outsider = new SessionNotificationPromptRepository(f.db, other.id);
  const native = { sessionId: 'shared-native', turnId: 'same-turn' };
  outsider.save(session.id, native, 'Other request');
  assert.equal(outsider.find(f.session.id, native), undefined);
  outsider.save(f.session.id, native, 'Must not overwrite');
  assert.equal(owner.find(f.session.id, native), 'Owner request');
  assert.equal(owner.find(session.id, native), undefined);
  assert.equal(outsider.find(session.id, native), 'Other request');
  const second = f.sessions.create({ projectId: f.project.id, name: 'Second', aiTool: 'codex', workingDir: f.project.path });
  owner.save(second.id, native, 'Same owner different terminal');
  assert.equal(owner.find(f.session.id, native), 'Owner request');
  f.db.prepare('DELETE FROM sessions WHERE id=?').run(f.session.id);
  assert.equal(owner.find(f.session.id, native), undefined);
  assert.equal(owner.find(second.id, native), 'Same owner different terminal');
});

it('bounds retained summaries and safely falls back for an evicted long-running turn', t => {
  const f = setup(t);
  f.submit('Old request', 'native-A', 'old-turn');
  f.submit('repeat once', 'native-A', 'old-turn');
  const count = () => (f.db.prepare('SELECT COUNT(*) AS n FROM session_notification_prompts WHERE user_id=? AND session_id=?')
    .get(f.user.id, f.session.id) as { n: number }).n;
  assert.equal(count(), 1);
  for (let i = 0; i < MAX_SESSION_NOTIFICATION_PROMPTS + 2; i++) f.submit(`New request ${i}`, 'native-A', `turn-${i}`);
  assert.equal(count(), MAX_SESSION_NOTIFICATION_PROMPTS);
  assert.equal(JSON.parse(f.stop('native-A', 'old-turn').payload!).last_prompt, undefined);
  assert.equal(JSON.parse(f.stop('native-A', `turn-${MAX_SESSION_NOTIFICATION_PROMPTS + 1}`).payload!).last_prompt,
    `New request ${MAX_SESSION_NOTIFICATION_PROMPTS + 1}`);
});

it('does not overwrite captured identity metadata from unauthenticated or child-agent submissions', t => {
  const f = setup(t);
  f.submit('Parent request', 'native-A', 'turn-1');
  assert.equal(f.hook({ hook_event_name: 'UserPromptSubmit', session_id: 'native-A', turn_id: 'turn-1', prompt: 'Impostor' }, 'wrong').status, 401);
  f.hook({ hook_event_name: 'UserPromptSubmit', session_id: 'native-A', turn_id: 'turn-1', agent_id: 'child', prompt: 'Child instruction' });
  const saved = f.stop('native-A', 'turn-1');
  assert.equal(JSON.parse(saved.payload!).last_prompt, 'Parent request');
  assert.equal(JSON.parse(saved.payload!).native_session_id, 'native-A');
  assert.equal(JSON.parse(saved.payload!).native_turn_id, 'turn-1');
  assert.equal(JSON.parse(saved.payload!).session_id, f.session.id);
});
