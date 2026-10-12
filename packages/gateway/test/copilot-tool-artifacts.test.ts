import assert from 'node:assert/strict';
import { it } from 'node:test';
import { fileURLToPath } from "node:url";
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { createAgentToolRegistry, executeAgentTool } from '../src/services/agent/tool-registry.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';

it('archives a real oversized project read and retrieves its redacted tail via the original receipt', async () => {
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  try {
    const userId = new UserRepository(db).create('artifact@test.dev', 'hash').id;
    const project = new ProjectRepository(db, userId).create({ name: 'large evidence', path: '/tmp/artifact-source', aiTool: 'codex', description: '证据'.repeat(30000) + ' TAIL-EVIDENCE sk-FAKESECRET123456' });
    const ledger = new CopilotRunLedger(db, userId), conversation = ledger.log.createConversation();
    const registry = createAgentToolRegistry(createPlatformTools()); let calls = 0;
    const masterKey = 'a'.repeat(64);
    const orchestrator = createCopilotOrchestrator({ db, masterKey, toolRegistry: registry, eventBus: new ForgeBadgerEventBus(), llm: {
      async stream(request) {
        if (++calls === 1) request.onEvent({ type: 'tool_call', toolCall: { id: 'get', name: 'get_project', arguments: JSON.stringify({ projectId: project.id }) } });
        return { message: 'Read evidence', usage: { totalTokens: 10 } };
      }, async summarize() { return 'summary'; }, async generateTitle() { return ''; }, async proposeMemory() { return []; }
    } });
    const runId = await orchestrator.runTurn({ userId, conversationId: conversation.id, userText: 'Inspect' });
    const receipt = ledger.log.listMessages(conversation.id).find(m => m.kind === 'tool_result')!;
    const context = { db, userId, masterKey, conversationId: conversation.id, runId, availableToolNames: ['get_project', 'read_tool_result'], checkExecutionAuthority: () => true };
    const tool = registry.tools.get('read_tool_result')!;
    const result = await executeAgentTool(tool, { messageId: receipt.id, offset: 59000, length: 6000 }, context);
    assert.equal(result.ok, true);
    const page = result.output as { content: string; originalOutputTruncated: boolean; artifactStatus: string };
    assert.match(page.content, /TAIL-EVIDENCE/);
    assert.equal(page.content.includes('sk-FAKESECRET123456'), false);
    assert.equal(page.originalOutputTruncated, false);
    assert.equal(page.artifactStatus, 'available');
    assert.ok(Buffer.byteLength(receipt.content) <= 48 * 1024);
    const persisted = JSON.stringify(db.prepare('SELECT * FROM copilot_tool_artifacts').all());
    assert.equal(persisted.includes('TAIL-EVIDENCE'), false, 'full data is encrypted at rest');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    ledger.log.deleteConversation(conversation.id);
    assert.equal((await executeAgentTool(tool, { messageId: receipt.id }, context)).ok, false);
  } finally { db.close(); }
});

import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CopilotToolArtifactRepository } from '../src/db/repositories/copilot-tool-artifact-repository.js';
import { MAX_ARTIFACT_BYTES, MAX_RUN_ARTIFACT_BYTES, MAX_USER_ARTIFACT_BYTES } from '../src/services/agent/tool-artifact-policy.js';
import type { TestContext } from 'node:test';

function artifactFixture(t: TestContext, fileBacked = false) {
  const root = mkdtempSync(join(tmpdir(), 'fb-artifact-'));
  const filename = join(root, 'fixture.sqlite');
  const db = new Database(fileBacked ? filename : ':memory:'); db.pragma('foreign_keys=ON');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const userId = new UserRepository(db).create('artifact-bounds@test.dev', 'hash').id;
  const project = new ProjectRepository(db, userId).create({ name: 'Source', path: root, aiTool: 'codex' });
  const ledger = new CopilotRunLedger(db, userId); const conversationId = ledger.log.createConversation().id;
  const runId = ledger.admit({ userId, conversationId, userText: 'inspect', projectId: project.id }, 16);
  const claim = ledger.claim(runId, 'artifact-owner', 120000)!; const masterKey = 'b'.repeat(64);
  const repository = new CopilotToolArtifactRepository(db, userId, masterKey);
  const tool = createPlatformTools().find(tool => tool.name === 'read_tool_result')!;
  const context = { db, userId, masterKey, conversationId, runId, availableToolNames: ['get_project', 'search_project_files', 'read_tool_result'], checkExecutionAuthority: () => true };
  function save(content: string, toolName = 'get_project') {
    const inputJson = JSON.stringify({ projectId: project.id });
    const step = ledger.addStep(runId, { kind: 'tool', toolCallId: `read-${ledger.steps(runId).length}`, toolName, inputJson });
    ledger.startStep(claim, step);
    ledger.receipt(claim, step, JSON.stringify({ truncated: true, preview: 'small' }), false, preview => {
      const artifact = repository.store({ runId, stepId: step.id, conversationId, toolName, inputJson }, content);
      return JSON.stringify({ ...JSON.parse(preview), artifact });
    });
    return { step, message: ledger.log.listMessages(conversationId).at(-1)! };
  }
  t.after(() => { if (db.open) db.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, filename, db, userId, project, ledger, conversationId, runId, claim, masterKey, repository, tool, context, save };
}

it('keeps the successful tool receipt when optional archive persistence fails, without retrying the tool', async t => {
  const f = artifactFixture(t);
  f.ledger.cancel(f.runId);
  f.db.prepare('UPDATE projects SET description=? WHERE id=?').run('evidence '.repeat(8000), f.project.id);
  f.db.exec("CREATE TRIGGER fail_artifact BEFORE INSERT ON copilot_tool_artifacts BEGIN SELECT RAISE(ABORT, 'fixture disk failure'); END");
  const registry = createAgentToolRegistry(createPlatformTools()); let calls = 0;
  const orchestrator = createCopilotOrchestrator({ db:f.db, masterKey:f.masterKey,toolRegistry:registry,eventBus:new ForgeBadgerEventBus(),llm:{
    async stream(request) {
      if (++calls === 1) request.onEvent({type:'tool_call',toolCall:{id:'read',name:'get_project',arguments:JSON.stringify({projectId:f.project.id})}});
      return {message:'done',usage:{totalTokens:10}};
    }, async summarize(){return 'summary';},async generateTitle(){return '';},async proposeMemory(){return [];}
  }});
  const runId = await orchestrator.runTurn({userId:f.userId,conversationId:f.conversationId,userText:'Read project'});
  assert.equal(f.ledger.get(runId)?.status,'completed');
  assert.equal(f.ledger.steps(runId).filter(step=>step.kind==='tool').length,1);
  const messages = f.ledger.log.listMessages(f.conversationId).filter(message=>message.kind==='tool_result');
  assert.equal(messages.length,1);assert.equal(JSON.parse(messages[0]!.content).artifact.status,'unavailable');
  assert.equal((f.db.prepare('SELECT count(*) n FROM copilot_tool_artifacts').get() as {n:number}).n,0);
});

it('preserves underlying truncation and rejects a revoked project snapshot', async t => {
  const f = artifactFixture(t);
  const record = f.save(JSON.stringify({files:[],truncated:true,nextOffset:40}));
  const page = await executeAgentTool(f.tool,{messageId:record.message.id},f.context);
  assert.equal((page.output as {originalOutputTruncated:boolean}).originalOutputTruncated,true);
  const other = new UserRepository(f.db).create('new-owner@test.dev','hash').id;
  f.db.prepare('UPDATE projects SET user_id=? WHERE id=?').run(other,f.project.id);
  assert.equal((await executeAgentTool(f.tool,{messageId:record.message.id},f.context)).ok,false);
});

it('retrieves beyond one million characters after file DB reopen, but rejects wrong keys and edited history', async t => {
  const f = artifactFixture(t, true);
  const record = f.save(JSON.stringify({ text: 'x'.repeat(1_100_000) + 'END' }));
  f.db.close(); const reopened = new Database(f.filename);
  try {
    const context = { ...f.context, db: reopened };
    const result = await executeAgentTool(f.tool, { messageId: record.message.id, offset: 1_099_900, length: 200 }, context);
    assert.equal(result.ok, true); assert.match((result.output as { content: string }).content, /END/);
    assert.equal((await executeAgentTool(f.tool, { messageId: record.message.id }, { ...context, masterKey: 'c'.repeat(64) })).ok, false);
    reopened.prepare('DELETE FROM copilot_messages WHERE id=?').run(record.message.id);
    assert.equal((await executeAgentTool(f.tool, { messageId: record.message.id }, context)).ok, false);
  } finally { reopened.close(); }
});

it('distinguishes expiration, size limits and unavailable legacy output; caps UTF-8 bytes', async t => {
  const f = artifactFixture(t);
  const record = f.save(JSON.stringify({ text: '界'.repeat(20000) }));
  f.db.prepare('UPDATE copilot_tool_artifacts SET expires_at=1').run();
  const expired = await executeAgentTool(f.tool, { messageId: record.message.id }, f.context);
  assert.equal((expired.output as { artifactStatus: string }).artifactStatus, 'expired');
  f.repository.cleanup();
  assert.equal((f.db.prepare('SELECT count(*) n FROM copilot_tool_artifacts').get() as { n: number }).n, 0);
  const tooLarge = f.save(JSON.stringify({ text: '界'.repeat(Math.ceil(MAX_ARTIFACT_BYTES / 3)) }));
  assert.equal(JSON.parse(tooLarge.message.content).artifact.status, 'too_large');
  const legacy = await executeAgentTool(f.tool, { messageId: tooLarge.message.id }, f.context);
  assert.equal((legacy.output as { originalOutputTruncated: boolean }).originalOutputTruncated, true);
});

it('rejects disabled tools, cross-tenant readback, changed project roots and paths replaced by symlinks', async t => {
  const f = artifactFixture(t); writeFileSync(join(f.root, 'source.ts'), 'evidence');
  const record = f.save(JSON.stringify({ matches: [{ path: 'source.ts', line: 1, text: 'evidence' }] }), 'search_project_files');
  assert.equal((await executeAgentTool(f.tool, { messageId: record.message.id }, f.context)).ok, true);
  const outsider = new UserRepository(f.db).create('artifact-outsider@test.dev', 'hash').id;
  for (const context of [{ ...f.context, availableToolNames: ['read_tool_result'] }, { ...f.context, userId: outsider }])
    assert.equal((await executeAgentTool(f.tool, { messageId: record.message.id }, context)).ok, false);
  rmSync(join(f.root, 'source.ts')); symlinkSync('/etc/hosts', join(f.root, 'source.ts'));
  assert.equal((await executeAgentTool(f.tool, { messageId: record.message.id }, f.context)).ok, false);
  f.db.prepare('UPDATE projects SET path=? WHERE id=?').run('/tmp', f.project.id);
  assert.equal((await executeAgentTool(f.tool, { messageId: record.message.id }, f.context)).ok, false);
});

it('does not archive late or stale-fence receipts and excludes terminal/MCP output', t => {
  const f = artifactFixture(t);
  const make = (toolName: string) => f.ledger.addStep(f.runId, { kind: 'tool', toolCallId: toolName, toolName, inputJson: '{}' });
  const terminal = make('get_session_output'); f.ledger.startStep(f.claim, terminal);
  assert.equal(f.repository.store({ conversationId: f.conversationId, runId: f.runId, stepId: terminal.id, toolName: terminal.tool_name!, inputJson: '{}' }, '{}').status, 'unavailable');
  const external = make('mcp_remote'); f.ledger.startStep(f.claim, external);
  assert.equal(f.repository.store({ conversationId: f.conversationId, runId: f.runId, stepId: external.id, toolName: external.tool_name!, inputJson: '{}' }, '{}').status, 'unavailable');
  for (const toolName of ['list_projects', 'get_usage_summary']) {
    const step = make(toolName); f.ledger.startStep(f.claim, step);
    assert.equal(f.repository.store({ conversationId:f.conversationId,runId:f.runId,stepId:step.id,toolName,inputJson:'{}' }, '{}').status,'unavailable');
  }
  const late = make('get_project'); f.ledger.startStep(f.claim, late); f.ledger.cancel(f.runId);
  let archived = false;
  f.ledger.receipt(f.claim, late, '{}', false, content => { archived = true; return content; });
  assert.equal(archived, false);
  assert.equal((f.db.prepare('SELECT count(*) n FROM copilot_tool_artifacts').get() as { n: number }).n, 0);
});

it('enforces run and owner quotas without evicting previously retained evidence', t => {
  const f = artifactFixture(t);
  const content = JSON.stringify('x'.repeat(MAX_ARTIFACT_BYTES - 2));
  for (let i = 0; i < MAX_RUN_ARTIFACT_BYTES / MAX_ARTIFACT_BYTES; i++) assert.equal(JSON.parse(f.save(content).message.content).artifact.status, 'available');
  assert.equal(JSON.parse(f.save(content).message.content).artifact.status, 'quota');
  // Additional valid runs fill the remaining owner allowance.
  for (let i = 1; i < MAX_USER_ARTIFACT_BYTES / MAX_RUN_ARTIFACT_BYTES; i++) {
    const conversationId = f.ledger.log.createConversation().id;
    const runId = f.ledger.admit({ userId: f.userId, conversationId, userText: 'inspect' }, 16);
    const claim = f.ledger.claim(runId, `owner-${i}`, 120000)!;
    for (let j = 0; j < 8; j++) {
      const step = f.ledger.addStep(runId, { kind: 'tool', toolCallId: `q${j}`, toolName: 'get_project', inputJson: JSON.stringify({projectId:f.project.id}) });
      f.ledger.startStep(claim, step);
      assert.equal(f.repository.store({ conversationId, runId, stepId: step.id, toolName: 'get_project', inputJson: JSON.stringify({projectId:f.project.id}) }, content).status, 'available');
    }
  }
  const conversationId = f.ledger.log.createConversation().id;
  const runId = f.ledger.admit({ userId: f.userId, conversationId, userText: 'inspect' }, 2), claim = f.ledger.claim(runId, 'last', 120000)!;
  const step = f.ledger.addStep(runId, { kind: 'tool', toolName: 'get_project', inputJson: JSON.stringify({projectId:f.project.id}) }); f.ledger.startStep(claim, step);
  assert.equal(f.repository.store({ conversationId, runId, stepId: step.id, toolName: 'get_project', inputJson: JSON.stringify({projectId:f.project.id}) }, '{}').status, 'quota');
  assert.equal((f.db.prepare('SELECT SUM(content_bytes) total FROM copilot_tool_artifacts').get() as { total: number }).total, MAX_USER_ARTIFACT_BYTES);
});


it('rolls back archive and receipt together when transcript persistence fails', t => {
  const f = artifactFixture(t);
  f.db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON copilot_messages WHEN NEW.kind='tool_result' BEGIN SELECT RAISE(ABORT,'fixture disk error'); END");
  assert.throws(() => f.save(JSON.stringify({ content: 'historical evidence' })), /fixture disk error/);
  assert.equal((f.db.prepare('SELECT count(*) n FROM copilot_tool_artifacts').get() as { n: number }).n, 0);
  assert.equal(f.ledger.log.listMessages(f.conversationId).filter(message => message.kind === 'tool_result').length, 0);
});

it('does not publish an archive from a superseded execution fence', t => {
  const f = artifactFixture(t);
  const step = f.ledger.addStep(f.runId, {kind:'tool',toolName:'get_project',toolCallId:'stale',inputJson:'{}'});
  f.ledger.startStep(f.claim, step);
  f.db.prepare('UPDATE copilot_runs SET lease_expires_at=0 WHERE id=?').run(f.runId);
  const newer = f.ledger.claim(f.runId, 'replacement', 30000)!;
  f.ledger.startStep(newer, step);
  let published = false;
  f.ledger.receipt(f.claim, step, '{}', false, value => { published = true; return value; });
  assert.equal(published, false);
});
