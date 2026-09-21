import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { PlatformActions } from '../../src/services/platform-commands/actions.js';
import { createPlatformCommands } from '../../src/services/platform-commands/catalog.js';
import { DevelopmentTaskRepository } from '../../src/db/repositories/development-task-repository.js';
import { startDevelopmentRuntime } from '../../src/services/development/runtime.js';
import { ForgeBadgerEventBus } from '../../src/services/event-bus.js';

// A separate OS process owns each database connection and runtime lifecycle.
// `node --test` discovers every file under test/: exit quietly when this
// worker is loaded without its spawn arguments instead of crashing the run.
if (!process.argv[2]) process.exit(0);
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const mode = process.argv[3]!;
const db = new Database(input.database);
db.pragma('foreign_keys=ON');
db.pragma('busy_timeout=5000');
const repo = new DevelopmentTaskRepository(db, input.userId);
const actions = new PlatformActions({ db, userId: input.userId, actionOrigin: { kind: 'owner_api' } }, createPlatformCommands());
const output = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');

if (mode === 'submit' || mode === 'submit-cancel') {
  const result = await actions.executeOwner('development.task.submit', input.plan, randomUUID()) as { taskId: string };
  if (mode === 'submit-cancel') await actions.executeOwner('development.task.cancel', { taskId: result.taskId, projectId: input.plan.projectId }, randomUUID());
  output({ ...result, pid: process.pid });
  db.close();
} else {
  const eventBus = new ForgeBadgerEventBus();
  const events: unknown[] = [];
  eventBus.on('event', event => {
    events.push(event);
    if (mode === 'outbox-fail') throw new Error('fixture transport unavailable');
  });
  const runtime = startDevelopmentRuntime({ db, eventBus });
  await runtime.ready;
  if (mode === 'hold') {
    output({ ready: true, pid: process.pid });
    setInterval(() => {}, 1000); // SIGKILL intentionally prevents graceful stop.
  } else {
    const deadline = Date.now() + 10000;
    while (mode === 'execute' && repo.list(input.plan.projectId).some(row => ['queued', 'running'].includes(row.status))) {
      if (Date.now() > deadline) throw new Error('fixture runtime deadline exceeded');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    runtime.tick();
    await runtime.stop();
    output({ pid: process.pid, events, rows: repo.list(input.plan.projectId), pending: repo.pendingEvents() });
    db.close();
  }
}
