import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { CopilotMachineRootRepository } from '../src/db/repositories/copilot-machine-root-repository.js';
import { CopilotConversationLog } from '../src/services/agent/conversation-log.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { computeToolSurface, MACHINE_ROOT_DEPENDENT_TOOLS } from '../src/services/agent/tool-surface.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';

const ENTRY_POINTS = ['register_machine_root', 'list_machine_roots'];

it('hides root-dependent machine tools only when the owner is known to have no root', () => {
  const registry = createAgentToolRegistry(createPlatformTools());
  const names = (hasMachineRoots?: boolean) => new Set(computeToolSurface({ source: 'user' },
    { registry, hasSessionManager: true, hasMachineRoots }).visible.map(tool => tool.name));
  const without = names(false), withRoot = names(true), unknown = names(undefined);
  for (const name of MACHINE_ROOT_DEPENDENT_TOOLS) {
    assert.ok(registry.tools.has(name), `${name} is a registered tool`);
    assert.equal(without.has(name), false, `${name} hidden without a root`);
    assert.equal(withRoot.has(name), true, `${name} visible with a root`);
    assert.equal(unknown.has(name), true, `${name} visible when root state is unknown`);
  }
  for (const name of ENTRY_POINTS) assert.equal(without.has(name), true, `${name} stays as the entry point`);
  assert.equal(withRoot.size - without.size, MACHINE_ROOT_DEPENDENT_TOOLS.size);
  const surface = computeToolSurface({ source: 'user' }, { registry, hasSessionManager: true, hasMachineRoots: false });
  assert.deepEqual(surface.exclusion('machine_search'), { layer: 'context-catalog', reason: 'NO_MACHINE_ROOT' });
  // Not an availability failure: a forged call is refused by the root lookup, not reported as a retired tool.
  assert.equal(surface.unavailableReason('machine_search'), null);
});

it('sends the model the smaller catalog until a root is registered, then the full one', async () => {
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const dir = mkdtempSync(path.join(tmpdir(), 'fb-surface-root-'));
  try {
    const user = new UserRepository(db).create('surface-root@test.dev', 'hash');
    const log = new CopilotConversationLog(db, user.id);
    const offered: string[][] = [];
    const orchestrator = createCopilotOrchestrator({ db, masterKey: 'a'.repeat(32), eventBus: new ForgeBadgerEventBus(),
      toolRegistry: createAgentToolRegistry(createPlatformTools()),
      llm: { async stream(request) { offered.push(request.tools.map(tool => tool.name)); return { message: 'done' }; },
        async summarize() { return ''; }, async generateTitle() { return ''; } } });
    await orchestrator.runTurn({ userId: user.id, conversationId: log.createConversation().id, userText: 'hello' });
    assert.ok(new CopilotMachineRootRepository(db, user.id).register('fixture', dir));
    await orchestrator.runTurn({ userId: user.id, conversationId: log.createConversation().id, userText: 'hello again' });
    const [before, after] = offered as [string[], string[]];
    for (const name of MACHINE_ROOT_DEPENDENT_TOOLS) {
      assert.equal(before.includes(name), false, `${name} not offered before a root exists`);
      assert.equal(after.includes(name), true, `${name} offered once a root exists`);
    }
    for (const name of ENTRY_POINTS) assert.equal(before.includes(name), true);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('still refuses a forged machine tool call when no root exists', async () => {
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  try {
    const user = new UserRepository(db).create('surface-forged@test.dev', 'hash');
    const log = new CopilotConversationLog(db, user.id);
    const conversation = log.createConversation();
    let calls = 0;
    const orchestrator = createCopilotOrchestrator({ db, masterKey: 'a'.repeat(32), eventBus: new ForgeBadgerEventBus(),
      toolRegistry: createAgentToolRegistry(createPlatformTools()),
      llm: { async stream(request) {
          if (calls++ === 0) request.onEvent({ type: 'tool_call', toolCall: { id: 'forged', name: 'machine_search', arguments: JSON.stringify({ root: 'missing', query: 'secret' }) } });
          return { message: calls === 1 ? '' : 'done' };
        }, async summarize() { return ''; }, async generateTitle() { return ''; } } });
    await orchestrator.runTurn({ userId: user.id, conversationId: conversation.id, userText: 'search' });
    const result = log.listMessages(conversation.id).find(row => row.kind === 'tool_result');
    assert.ok(result, 'the forged call produced a receipt');
    assert.match(result.content, /MACHINE_ROOT_NOT_FOUND|Invalid tool input|Denied/);
    assert.doesNotMatch(result.content, /"matches"/);
  } finally { db.close(); }
});
