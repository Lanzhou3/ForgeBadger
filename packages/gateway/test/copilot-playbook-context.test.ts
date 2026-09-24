import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { SkillRepository } from '../src/db/repositories/skill-repository.js';
import { PlatformActionRepository } from '../src/db/repositories/platform-action-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { visibleToolSchemas } from '../src/services/agent/tool-availability.js';
import { listCopilotPlaybooks, listEnabledCopilotPlaybookSummaries } from '../src/services/agent/skills/skill-queries.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { AgentError } from '../src/services/agent/types.js';
import type { AgentLlmClient } from '../src/services/agent/orchestrator-types.js';

type ModelRequest = Parameters<AgentLlmClient['stream']>[0];
interface ModelCall { name: string; input: Record<string, unknown>; }
interface Emission { calls: ModelCall[]; before?: () => void; }
function fixture(disabled = new Set<string>()) {
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations/', import.meta.url)) });
  const user = new UserRepository(db).create('playbook-context@test.dev', 'hash');
  const project = new ProjectRepository(db, user.id).create({ name: 'allowed', path: '/tmp/playbook-context', aiTool: 'codex' });
  const registry = createAgentToolRegistry(createPlatformTools());
  const ledger = new CopilotRunLedger(db, user.id);
  const requests: ModelRequest[] = [];
  let emissions: Emission[] = [];
  function emit(calls: ModelCall[], before?: () => void) { emissions.push({ calls, ...(before ? { before } : {}) }); }
  const orchestrator = createCopilotOrchestrator({
    db, masterKey: randomBytes(32).toString('hex'), toolRegistry: registry,
    eventBus: new ForgeBadgerEventBus(), isToolDisabled: name => disabled.has(name),
    llm: {
      async stream(request) {
        requests.push(request);
        const emission = emissions.shift();
        emission?.before?.();
        for (const [index, call] of (emission?.calls ?? []).entries()) request.onEvent({ type: 'tool_call', toolCall: {
          id: `model-call-${requests.length}-${index}`, name: call.name, arguments: JSON.stringify(call.input)
        } });
        return { message: 'Observed tool results.' };
      },
      async summarize() { return ''; },
      async generateTitle() { return ''; },
      async proposeMemory() { return []; }
    }
  });
  function effective(scheduled = false) {
    return visibleToolSchemas(registry, { hasSessionManager: false, isToolDisabled: name => disabled.has(name), ...(scheduled ? { scheduled: true } : {}) }).map(tool => tool.name);
  }
  async function turn(text: string, options: { scheduled?: boolean; projectId?: string } = {}) {
    const conversation = ledger.log.createConversation();
    const runId = await orchestrator.runTurn({ userId: user.id, conversationId: conversation.id, userText: text,
      ...(options.scheduled ? { source: 'scheduled' as const } : {}), ...(options.projectId ? { projectId: options.projectId } : {}) });
    assert.equal(ledger.get(runId)?.status, 'completed');
    return ledger.log.listMessages(conversation.id);
  }
  return { db, user, project, registry, disabled, requests, effective, turn, emit, orchestrator, ledger };
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

it('playbook listing and forged direct loads expose only the owner\'s available copilot skills', async () => {
  const f = fixture();
  try {
    const catalog = listCopilotPlaybooks(f.db, f.user.id, { availableToolNames: f.effective() });
    const canonical = catalog.find(row => row.name === 'safety-and-approvals')!;
    const foreignUser = new UserRepository(f.db).create('foreign-tenant@test.dev', 'hash');
    const foreignBook = new SkillRepository(f.db, foreignUser.id, 'copilot').create({ name: 'foreign-tenant-playbook', description: 'CLASSIFIED_FOREIGN_METADATA', content: 'CLASSIFIED_FOREIGN_BODY', version: '2.0.0' });
    const cli = new SkillRepository(f.db, f.user.id).create({ name: 'private-cli-skill', content: 'CLASSIFIED_CLI_BODY' });
    const text = assistantText(await f.turn('/playbooks'));
    assert.ok(text.includes(`- ${canonical.name}: ${canonical.description}`));
    // No Grant capability whitelist remains: the owner's full tool surface makes telemetry playbooks listable.
    assert.ok(text.includes('- usage-analysis:'));
    assert.ok(!text.includes('CLASSIFIED'));
    assert.ok(!text.includes('- foreign-tenant-playbook:'));
    assert.equal(f.requests.length, 0);
    f.emit([canonical, foreignBook, cli].map(row => ({ name: 'load_playbook', input: { id: row.id } })));
    const messages = await f.turn('Load these explicitly supplied IDs');
    const results = messages.filter(message => message.kind === 'tool_result').map(message => JSON.parse(message.content) as { found: boolean; id: string; body?: string });
    assert.equal(results.length, 3);
    assert.deepEqual(results.map(result => result.found), [true, false, false]);
    assert.equal(results[0]!.body, canonical.content);
    assert.ok(!JSON.stringify(messages).includes('CLASSIFIED'));
    assert.ok(!JSON.stringify(f.requests).includes('CLASSIFIED'));
    assert.ok(f.requests[0]!.tools.some(tool => tool.name === 'list_playbooks'));
    assert.ok(f.requests[0]!.tools.some(tool => tool.name === 'load_playbook'));
  } finally { f.db.close(); }
});

it('project autonomy switch gates copilot-origin platform writes at the intent level', async () => {
  const f = fixture();
  try {
    const projects = new ProjectRepository(f.db, f.user.id);
    assert.equal(projects.getCopilotAutonomy(f.project.id), false);

    // Switch OFF (default): project-scoped write refused with the switch guidance; no intent, no memory.
    f.emit([{ name: 'write_memory', input: { kind: 'fact', scope: 'project', projectId: f.project.id, text: 'Switch is off' } }]);
    const offMessages = await f.turn('Write the project memory');
    const offResult = offMessages.find(message => message.kind === 'tool_result')!.content;
    assert.equal(offResult, 'Denied by security policy: COPILOT_PROJECT_AUTONOMY_OFF: 项目「allowed」未开启 Copilot 自治，请在 Web 控制台项目设置中开启后重试');
    assert.equal((f.db.prepare('SELECT count(*) n FROM platform_action_intents').get() as { n: number }).n, 0);
    assert.equal((f.db.prepare('SELECT count(*) n FROM copilot_memory').get() as { n: number }).n, 0);

    // No project in scope: copilot origin cannot perform global writes.
    f.emit([{ name: 'write_memory', input: { kind: 'fact', scope: 'global', text: 'No project scope' } }]);
    const globalMessages = await f.turn('Write a global memory');
    const globalResult = globalMessages.find(message => message.kind === 'tool_result')!.content;
    assert.equal(globalResult, 'Denied by security policy: COPILOT_GLOBAL_ACTION_REQUIRES_WEB: 请在 Web 控制台手动执行');

    // Switch ON: the intent is auto-approved, then exact one-shot approval executes it to a confirmed receipt.
    projects.setCopilotAutonomy(f.project.id, true);
    assert.equal(projects.getCopilotAutonomy(f.project.id), true);
    f.emit([{ name: 'write_memory', input: { kind: 'fact', scope: 'project', projectId: f.project.id, text: 'Switch is on' } }]);
    const conversation = f.ledger.log.createConversation();
    const runId = await f.orchestrator.runTurn({ userId: f.user.id, conversationId: conversation.id, userText: 'Write the project memory now' });
    assert.equal(f.ledger.get(runId)?.status, 'awaiting_approval');
    const pending = f.ledger.log.listPendingActions(runId);
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.tool, 'write_memory');
    assert.equal((await f.orchestrator.resumeAfterApproval({ userId: f.user.id, runId, actionId: pending[0]!.id, approved: true })).resumed, true);
    assert.equal(f.ledger.get(runId)?.status, 'completed');
    const writeStep = f.ledger.steps(runId).find(step => step.tool_name === 'write_memory')!;
    const intents = new PlatformActionRepository(f.db, f.user.id);
    const intent = intents.byKey(writeStep.id)!;
    assert.equal(intent.status, 'completed');
    assert.equal(intent.origin_kind, 'copilot');
    assert.equal(intent.origin_run_id, runId);
    assert.equal(intents.receipt(intent.id)?.outcome, 'confirmed');
    assert.match(f.ledger.log.listMessages(conversation.id).find(message => message.kind === 'tool_result')!.content, /"receiptOutcome":"confirmed"/);
    assert.equal((f.db.prepare('SELECT count(*) n FROM copilot_memory').get() as { n: number }).n, 1);

    // Hot ON -> OFF: the next intent is refused again even though the switch was on before.
    projects.setCopilotAutonomy(f.project.id, false);
    f.emit([{ name: 'write_memory', input: { kind: 'fact', scope: 'project', projectId: f.project.id, text: 'Switch flipped off again' } }]);
    const hotMessages = await f.turn('Write again after the switch went off');
    assert.match(hotMessages.find(message => message.kind === 'tool_result')!.content, /COPILOT_PROJECT_AUTONOMY_OFF: 项目「allowed」未开启 Copilot 自治/);
    assert.equal((f.db.prepare('SELECT count(*) n FROM copilot_memory').get() as { n: number }).n, 1);

    // Owner scope isolation: another tenant's project is not addressable in a turn.
    const foreignUser = new UserRepository(f.db).create('scope-other@test.dev', 'hash');
    const foreignProject = new ProjectRepository(f.db, foreignUser.id).create({ name: 'foreign', path: '/tmp/foreign-playbook-context', aiTool: 'codex' });
    await assert.rejects(
      () => f.turn('Inspect the foreign project', { projectId: foreignProject.id }),
      (error: unknown) => error instanceof AgentError && error.code === 'COPILOT_PROJECT_NOT_FOUND'
    );
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
