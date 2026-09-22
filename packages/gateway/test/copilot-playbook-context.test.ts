import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { SkillRepository } from '../src/db/repositories/skill-repository.js';
import { CopilotGrantRepository } from '../src/db/repositories/copilot-grant-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { visibleToolSchemas } from '../src/services/agent/tool-availability.js';
import { listCopilotPlaybooks, listEnabledCopilotPlaybookSummaries } from '../src/services/agent/skills/skill-queries.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import type { AgentLlmClient } from '../src/services/agent/orchestrator-types.js';

type ModelRequest = Parameters<AgentLlmClient['stream']>[0];
interface ModelCall { name: string; input: Record<string, unknown>; }
function fixture(disabled = new Set<string>()) {
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: new URL('../src/db/migrations/', import.meta.url).pathname });
  const user = new UserRepository(db).create('playbook-context@test.dev', 'hash');
  const project = new ProjectRepository(db, user.id).create({ name: 'allowed', path: '/tmp/playbook-context', aiTool: 'codex' });
  const grant = new CopilotGrantRepository(db, user.id).create({
    name: 'project-bound', scope: { projectIds: [project.id], capabilities: ['memory.write'], allowedRoots: [] },
    expiresAt: Date.now() + 60_000, maxActions: 5, maxConcurrency: 1
  });
  const registry = createAgentToolRegistry(createPlatformTools());
  const ledger = new CopilotRunLedger(db, user.id);
  const requests: ModelRequest[] = [];
  let emissions: ModelCall[] = [];
  let beforeEmit: (() => void) | undefined;
  let firstModelTurn = true;
  const orchestrator = createCopilotOrchestrator({
    db, masterKey: randomBytes(32).toString('hex'), toolRegistry: registry,
    eventBus: new ForgeBadgerEventBus(), isToolDisabled: name => disabled.has(name),
    llm: {
      async stream(request) {
        requests.push(request);
        if (firstModelTurn) {
          firstModelTurn = false;
          beforeEmit?.();
          for (const [index, call] of emissions.entries()) request.onEvent({ type: 'tool_call', toolCall: {
            id: `model-call-${index}`, name: call.name, arguments: JSON.stringify(call.input)
          } });
        }
        return { message: 'Observed tool results.' };
      },
      async summarize() { return ''; },
      async generateTitle() { return ''; }
    }
  });
  function effective(grantBound = false, scheduled = false) {
    return visibleToolSchemas(registry, { hasSessionManager: false, isToolDisabled: name => disabled.has(name), grantBound, scheduled }).map(tool => tool.name);
  }
  async function turn(text: string, options: { grantBound?: boolean; scheduled?: boolean } = {}) {
    const conversation = ledger.log.createConversation();
    const runId = await orchestrator.runTurn({ userId: user.id, conversationId: conversation.id, userText: text,
      ...(options.grantBound ? { grantId: grant.id } : {}), ...(options.scheduled ? { source: 'scheduled' as const } : {}) });
    assert.equal(ledger.get(runId)?.status, 'completed');
    return ledger.log.listMessages(conversation.id);
  }
  return { db, user, grant, registry, disabled, requests, effective, turn,
    emit(calls: ModelCall[], before?: () => void) { emissions = calls; beforeEmit = before; } };
}

function assistantText(messages: Awaited<ReturnType<ReturnType<typeof fixture>['turn']>>) {
  return messages.filter(message => message.role === 'assistant' && message.kind === 'text').map(message => message.content).join('\n');
}

it('slash /playbooks obeys disabled listing and dependencies using the actual registry', async () => {
  const f = fixture(new Set(['list_playbooks']));
  try {
    const hidden = assistantText(await f.turn('/playbooks'));
    assert.equal(hidden, 'Available Copilot playbooks (0):');
    assert.equal(f.requests.length, 0);
    f.disabled.delete('list_playbooks');
    f.disabled.add('get_project');
    const text = assistantText(await f.turn('/playbooks'));
    const summaries = listEnabledCopilotPlaybookSummaries(f.db, f.user.id, { availableToolNames: f.effective() });
    assert.equal(text, [`Available Copilot playbooks (${summaries.length}):`, ...summaries.map(row => `- ${row.name}: ${row.description}`)].join('\n'));
    assert.ok(!text.includes('- project-insights:'));
    assert.ok(text.includes('- safety-and-approvals:'));
    assert.equal(f.requests.length, 0);
  } finally { f.db.close(); }
});

it('scheduled slash catalog and forged direct loads exclude write-dependent playbooks', async () => {
  const f = fixture();
  try {
    const text = assistantText(await f.turn('/playbooks', { scheduled: true }));
    assert.ok(text.includes('- safety-and-approvals:'));
    assert.ok(text.includes('- usage-analysis:'));
    assert.ok(!text.includes('- project-insights:'));
    assert.ok(!text.includes('- memory-playbook:'));
    assert.equal(f.requests.length, 0);
    const memory = listCopilotPlaybooks(f.db, f.user.id, { availableToolNames: f.effective() }).find(row => row.name === 'memory-playbook')!;
    f.emit([{ name: 'load_playbook', input: { id: memory.id } }]);
    const messages = await f.turn('Load the known write workflow ID anyway', { scheduled: true });
    const result = messages.find(message => message.kind === 'tool_result')!;
    assert.deepEqual(JSON.parse(result.content), { found: false, id: memory.id });
    assert.equal(f.requests[0]!.tools.some(tool => tool.name === 'write_memory'), false);
    assert.equal((f.db.prepare('SELECT count(*) n FROM platform_action_intents').get() as { n: number }).n, 0);
  } finally { f.db.close(); }
});

it('Grant slash and forged direct loads allow canonical guidance but never private or edited global content', async () => {
  const f = fixture();
  try {
    const repo = new SkillRepository(f.db, f.user.id, 'copilot');
    const catalog = listCopilotPlaybooks(f.db, f.user.id, { availableToolNames: f.effective() });
    const canonical = catalog.find(row => row.name === 'safety-and-approvals')!;
    const edited = catalog.find(row => row.name === 'memory-playbook')!;
    repo.update(edited.id, { description: 'CLASSIFIED_EDITED_METADATA', content: 'CLASSIFIED_EDITED_BODY' });
    const privateBook = repo.create({ name: 'private-global-playbook', description: 'CLASSIFIED_PRIVATE_METADATA', content: 'CLASSIFIED_PRIVATE_BODY', version: '2.0.0' });
    const cli = new SkillRepository(f.db, f.user.id).create({ name: 'private-cli-skill', content: 'CLASSIFIED_CLI_BODY' });
    const text = assistantText(await f.turn('/playbooks', { grantBound: true }));
    assert.ok(text.includes(`- ${canonical.name}: ${canonical.description}`));
    assert.ok(!text.includes('CLASSIFIED'));
    assert.ok(!text.includes('- memory-playbook:'));
    assert.ok(!text.includes('- usage-analysis:')); // Its global telemetry dependency is hidden under a Grant.
    assert.equal(f.requests.length, 0);
    f.emit([canonical, edited, privateBook, cli].map(row => ({ name: 'load_playbook', input: { id: row.id } })));
    const messages = await f.turn('Load these explicitly supplied IDs', { grantBound: true });
    const results = messages.filter(message => message.kind === 'tool_result').map(message => JSON.parse(message.content) as { found: boolean; id: string; body?: string });
    assert.equal(results.length, 4);
    assert.deepEqual(results.map(result => result.found), [true, false, false, false]);
    assert.equal(results[0]!.body, canonical.content);
    assert.ok(!JSON.stringify(messages).includes('CLASSIFIED'));
    assert.ok(!JSON.stringify(f.requests).includes('CLASSIFIED'));
    assert.ok(f.requests[0]!.tools.some(tool => tool.name === 'list_playbooks'));
    assert.ok(f.requests[0]!.tools.some(tool => tool.name === 'load_playbook'));
  } finally { f.db.close(); }
});

it('rechecks the effective dependency set when a model emits a previously known playbook ID', async () => {
  const f = fixture();
  try {
    const row = listCopilotPlaybooks(f.db, f.user.id, { availableToolNames: f.effective() }).find(book => book.name === 'project-insights')!;
    assert.equal(row.available, true);
    f.emit([{ name: 'load_playbook', input: { id: row.id } }], () => f.disabled.add('get_project'));
    const messages = await f.turn('Load the project guide');
    assert.ok(f.requests[0]!.tools.some(tool => tool.name === 'get_project'));
    assert.deepEqual(JSON.parse(messages.find(message => message.kind === 'tool_result')!.content), { found: false, id: row.id });
  } finally { f.db.close(); }
});

it('rejects a forged load_playbook emission when its own tool switch is disabled', async () => {
  const f = fixture(new Set(['load_playbook']));
  try {
    const row = listCopilotPlaybooks(f.db, f.user.id, { availableToolNames: f.effective() }).find(book => book.name === 'safety-and-approvals')!;
    f.emit([{ name: 'load_playbook', input: { id: row.id } }]);
    const messages = await f.turn('Emit a disabled load tool anyway');
    assert.equal(f.requests[0]!.tools.some(tool => tool.name === 'load_playbook'), false);
    assert.match(messages.find(message => message.kind === 'tool_result')!.content, /Tool disabled by owner: load_playbook/);
    assert.ok(!JSON.stringify(messages).includes(row.content));
  } finally { f.db.close(); }
});


it('automatic skill catalog obeys loader and resource availability', async () => {
  for (const disabled of [new Set(['load_playbook']), new Set(['read_skill_resource']), new Set<string>()]) {
    const f = fixture(disabled);
    try {
      await f.turn('Explain the available workflows');
      const catalog = f.requests[0]!.messages.find(message => typeof message.content === 'string' && message.content.startsWith('Available skills ('));
      assert.equal(!!catalog, !disabled.has('load_playbook'));
      if (catalog) assert.equal(String(catalog.content).includes('Use read_skill_resource'), !disabled.has('read_skill_resource'));
    } finally { f.db.close(); }
  }
});
