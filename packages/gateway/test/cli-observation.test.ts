import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { SessionRepository } from '../src/db/repositories/session-repository.js';
import { NotificationRepository } from '../src/db/repositories/notification-repository.js';
import { CliObservationRepository, MAX_CLI_OBSERVATIONS } from '../src/db/repositories/cli-observation-repository.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { attachNotificationPersistence } from '../src/services/notification-events.js';
import { handleSessionNotificationHook } from '../src/routes/session-hooks.js';
import { createNotificationDeduper } from '../src/services/notification-dedupe.js';
import { adapterIds } from '../src/lib/adapter-ids.js';
import { cliAdapterLabels, cliText, directCliFields } from '../src/services/notifications/cli-observation.js';

function fixture(t: TestContext) {
  const db = new Sqlite(':memory:'); t.after(() => db.close()); db.pragma('foreign_keys=ON');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const user = new UserRepository(db).create('observe@test.dev', 'hash');
  const project = new ProjectRepository(db, user.id).create({ name: 'Fixture', path: '/tmp/cli-observation', aiTool: 'codex' });
  const sessions = new SessionRepository(db, user.id);
  const session = sessions.create({ name: 'Fixture', projectId: project.id, workingDir: project.path, aiTool: 'codex', attachToken: 'fixture' });
  const bus = new ForgeBadgerEventBus(); attachNotificationPersistence({ db, eventBus: bus });
  const records = new CliObservationRepository(db, user.id), notices = new NotificationRepository(db, user.id);
  const deduper = createNotificationDeduper();
  const hook = (hook_event_name: string, turn_id?: string, extra: Record<string, unknown> = {}, token = 'fixture') =>
    handleSessionNotificationHook(db, bus, { adapter: 'codex', session_id: 'native', turn_id, hook_event_name, ...extra }, token, session.id, deduper);
  return { db, user, session, sessions, bus, records, notices, hook };
}

it('freezes the exact round before synchronous notification persistence and ignores new rounds and child events', t => {
  const f = fixture(t);
  f.hook('UserPromptSubmit', 'A', { prompt: 'Request A' });
  f.hook('PostToolUse', 'A', { tool_name: 'Bash', tool_response: { stdout: 'private raw output', exit_code: 0 } });
  f.hook('UserPromptSubmit', 'B', { prompt: 'Request B' });
  f.hook('Stop', 'A', { last_assistant_message: 'Request A\nFixed card; password=fixture-secret', transcript_path: '/etc/passwd' });
  const saved = f.notices.list()[0]!;
  const snapshot = JSON.parse(saved.payload!).cli_summary;
  assert.equal(snapshot.request, 'Request A'); assert.equal(snapshot.state, 'task_completed');
  assert.match(snapshot.result.text, /Fixed card/); assert.doesNotMatch(snapshot.result.text, /fixture-secret|Request A/);
  assert.equal(snapshot.progress[0].source, 'native_tool_event'); assert.deepEqual(snapshot.verification, []);
  f.hook('PostToolUse', 'A', { tool_name: 'Late tool' });
  f.hook('Stop', 'B', { last_assistant_message: 'Child result', agent_id: 'child' });
  assert.equal(f.notices.list().length, 1);
  assert.deepEqual(f.notices.get(saved.id), saved);
  const all = f.db.prepare('SELECT summary_json FROM cli_observations').all();
  assert.doesNotMatch(JSON.stringify(all), /private raw output|fixture-secret|\/etc\/passwd|Child result|Late tool/);
  assert.equal(f.bus.getSessionWorkState(f.user.id, f.session.id)?.state, 'working');
  assert.equal(f.records.current(f.session.id, 'fixture')?.request, 'Request B');
  assert.equal(f.records.latestResult(f.session.id)?.request, 'Request A');
});

it('degrades no-turn fields without borrowing a later request or progress', t => {
  const f = fixture(t);
  f.hook('UserPromptSubmit', undefined, { prompt: 'Old request' });
  f.hook('UserPromptSubmit', undefined, { prompt: 'New request' });
  f.hook('PostToolUse', undefined, { tool_name: 'Unknown round' });
  f.hook('Stop', undefined, { last_assistant_message: 'Old reply' });
  const payload = JSON.parse(f.notices.list()[0]!.payload!);
  assert.equal(payload.last_prompt, undefined); assert.equal(payload.cli_summary.request, undefined);
  assert.equal(payload.cli_summary.identityQuality, 'session_only');
  assert.equal(payload.cli_summary.result.text, 'Old reply'); assert.deepEqual(payload.cli_summary.progress, []);
});

it('retains runtime epoch across repository recreation and rotates on authenticated token rotation', t => {
  const f = fixture(t);
  f.hook('UserPromptSubmit', 'same-turn', { prompt: 'Previous runtime' });
  const epoch = f.records.latest(f.session.id)!.runtimeEpoch;
  assert.equal(new CliObservationRepository(f.db, f.user.id).runtime(f.session.id, 'fixture'), epoch);
  f.sessions.update(f.session.id, { attachToken: 'rotated' });
  assert.equal(f.hook('Stop', 'same-turn', { last_assistant_message: 'New process reply' }, 'fixture').status, 401);
  f.hook('Stop', 'same-turn', { last_assistant_message: 'New process reply' }, 'rotated');
  const summary = JSON.parse(f.notices.list()[0]!.payload!).cli_summary;
  assert.notEqual(summary.runtimeEpoch, epoch); assert.equal(summary.request, undefined);
  assert.doesNotMatch(JSON.stringify(summary), /rotated|fixture/);
});

it('keeps lifecycle when optional fields are malformed and maps bounded Kimi errors separately', t => {
  const f = fixture(t);
  assert.equal(f.hook('Stop', 'bad', { last_assistant_message: { text: 'invalid' } }).status, 200);
  assert.equal(JSON.parse(f.notices.list()[0]!.payload!).cli_summary.result, undefined);
  f.hook('TurnStarted', 'kimi-turn', { adapter: 'kimi', prompt: 'Kimi exact request' });
  f.hook('StopFailure', 'kimi-turn', { adapter: 'kimi', error_type: 'RateLimitError', error_message: '429 password=secret-fixture' });
  const summary = f.records.latest(f.session.id)!;
  assert.equal(summary.request, 'Kimi exact request'); assert.equal(summary.errorCategory, 'rate_limit');
  assert.match(summary.error!.text, /429/); assert.doesNotMatch(summary.error!.text, /secret-fixture/);
  assert.equal(directCliFields('kimi', { hook_event_name: 'Stop', last_assistant_message: 'Unverified native contract' }).result, undefined);
});

it('bounds source observation retention to 128 rounds and 7 days, isolates tenants and cascades deletion', t => {
  const f = fixture(t);
  for (let i = 0; i < MAX_CLI_OBSERVATIONS + 5; i++) f.hook('UserPromptSubmit', String(i), { prompt: 'Request ' + i });
  const count = () => (f.db.prepare('SELECT COUNT(*) n FROM cli_observations').get() as { n: number }).n;
  assert.equal(count(), MAX_CLI_OBSERVATIONS);
  const other = new UserRepository(f.db).create('outsider-observe@test.dev', 'hash');
  const outsider = new CliObservationRepository(f.db, other.id);
  assert.equal(outsider.latest(f.session.id), undefined); assert.equal(outsider.runtime(f.session.id, 'fixture'), undefined);
  f.db.prepare('UPDATE cli_observations SET observed_at=?').run(Date.now() - 8 * 86400_000);
  assert.equal(f.records.latest(f.session.id), undefined); assert.equal(count(), 0);
  f.hook('UserPromptSubmit', 'fresh', { prompt: 'Fresh' });
  f.db.prepare('DELETE FROM sessions WHERE id=?').run(f.session.id);
  assert.equal(count(), 0);
  assert.equal((f.db.prepare('SELECT COUNT(*) n FROM cli_observation_runtimes').get() as { n: number }).n, 0);
});

it('has explicit labels and safe detail downgrade for every registered CLI including mcode', () => {
  assert.deepEqual(Object.keys(cliAdapterLabels).sort(), [...adapterIds].sort());
  for (const adapter of adapterIds) {
    const fields = directCliFields(adapter, { hook_event_name: 'Stop', last_assistant_message: 'Final' });
    assert.equal(Boolean(fields.result), ['claude', 'codex', 'opencode', 'pi'].includes(adapter));
  }
});

it('normalizes terminal control sequences before redacting the complete field', () => {
  for (const input of ['pass\x1b[31mword=fixture-private', 'pass\x00word=fixture-private']) {
    assert.doesNotMatch(cliText(input, 600), /fixture-private/);
    assert.match(cliText(input, 600), /REDACTED/);
  }
});
