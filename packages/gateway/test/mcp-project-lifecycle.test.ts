import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createMcpRoutes } from '../src/routes/mcp.js';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { ProjectManagerRepository } from '../src/db/repositories/project-manager-repository.js';
import { McpTokenRepository } from '../src/db/repositories/mcp-token-repository.js';
import { snapshotMcpProjects } from '../src/services/mcp/token-authority.js';
import { SessionRepository } from '../src/db/repositories/session-repository.js';
import { SessionRuntimeConfirmationRepository } from '../src/db/repositories/session-runtime-confirmation-repository.js';
import { InMemorySessionManager } from '../src/services/session-manager.js';
import { withTaskPacketSessionLink } from '../src/services/project-manager/task-packets.js';
import { PlatformActions } from '../src/services/platform-commands/actions.js';
import { createPlatformCommands } from '../src/services/platform-commands/catalog.js';
import { planDigest } from '../src/services/mcp/lifecycle.js';
import { randomUUID } from 'node:crypto';

async function fixture(t: TestContext) {
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'fb-mcp-cycle-')));
  const userId = new UserRepository(db).create('mcp-cycle@example.test', 'hash').id;
  const projects = new ProjectRepository(db, userId);
  mkdirSync(path.join(root, 'app')); mkdirSync(path.join(root, 'outside'));
  const project = projects.create({ name: 'fixture', path: path.join(root, 'app'), aiTool: 'codex' });
  const other = projects.create({ name: 'outside', path: path.join(root, 'outside'), aiTool: 'codex' });
  const repo = new ProjectManagerRepository(db, userId);
  const tokens = new McpTokenRepository(db);
  const args = { userId, name: 'fixture', scopes: ['read', 'operate'] as ('read' | 'operate')[],
    allowedProjects: snapshotMcpProjects(db, userId, [project.id]), expiresAt: new Date(Date.now() + 3600000) };
  const old = tokens.create(args), grant = tokens.create(args);
  db.prepare('UPDATE mcp_access_tokens SET scopes=? WHERE id=?').run(JSON.stringify(['read', 'operate', 'lifecycle']), grant.record.id);
  let probe: (() => void) | undefined;
  const runtimes = new Set<string>();
  const manager = new InMemorySessionManager({
    async createSession() {}, async killSession(name) { runtimes.delete(name); },
    async listSessions() { return [...runtimes]; }, async capturePane() { return ''; },
    async hasSession(name) { probe?.(); return runtimes.has(name); }
  }, undefined, undefined, { db });
  const app = express(); app.use(express.json());
  app.use('/mcp', createMcpRoutes({ db, masterKey: 'x'.repeat(32), appVersion: 'test', sessionManager: manager }));
  const server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); rmSync(root, { recursive: true, force: true }); });
  async function call(name: string, input: Record<string, unknown> = {}, token = grant.token) {
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: input } })
    });
    assert.equal(response.status, 200);
    const line = (await response.text()).split('\n').find(row => row.startsWith('data:'))!;
    return (JSON.parse(line.slice(5)) as { result: { isError?: boolean; content: Array<{ text: string }> } }).result;
  }
  async function ok(name: string, input: Record<string, unknown> = {}) {
    const result = await call(name, input); assert.notEqual(result.isError, true, result.content[0]!.text);
    return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
  }
  const readPlan = () => ok('pm_get_plan', { projectId: project.id });
  async function list(token = grant.token) {
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    });
    const line = (await response.text()).split('\n').find(row => row.startsWith('data:'))!;
    const result = JSON.parse(line.slice(5)) as { result?: { tools: Array<{ name: string; inputSchema: { anyOf?: Array<{ properties: Record<string, unknown>; required: string[] }> } }> }; error?: unknown };
    assert.ok(result.result, JSON.stringify(result.error)); return result.result.tools;
  }
  async function authStatus() {
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${grant.token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    });
    await response.text(); return response.status;
  }
  return { db, userId, project, other, repo, tokens, grant, old, call, ok, readPlan, list, authStatus, runtimes, manager,
    duringProbe(callback: () => void) { probe = callback; } };
}

test('lifecycle discovery describes every strict stage alternative including operation IDs', async t => {
  const f = await fixture(t), tools = await f.list();
  const stage = tools.find(v => v.name === 'pm_manage_stage'); assert.ok(stage);
  assert.equal(stage.inputSchema.anyOf?.length, 4);
  for (const alternative of stage.inputSchema.anyOf ?? []) {
    assert.ok(alternative.properties.operationId); assert.ok(alternative.required.includes('operationId'));
  }
  const oldNames = (await f.list(f.old.token)).map(v => v.name);
  assert.equal(oldNames.includes('pm_review_task'), false);
  assert.ok(oldNames.includes('get_project_git_status')); assert.ok(oldNames.includes('read_project_diff'));
});

test('MCP rejects credential material before writing lifecycle intents or business records', async t => {
  const f = await fixture(t), projectId = f.project.id;
  const item = f.repo.createWorkItem(projectId, { title: 'Credential boundary' });
  const expectedRevision = f.repo.taskMetadata(projectId, item.id).revision;
  const sensitive = ['sk-fictional-example-only', 'Bash-sk-fictional-example-only', 'Bearer fictional-example-only',
    '{"apiKey":"fictional-example-only"}', '-----BEGIN PRIVATE KEY-----\nfictional-example-only\n-----END PRIVATE KEY-----'];
  for (const [index, ref] of sensitive.entries()) {
    const result = await f.call('pm_attach_evidence', { projectId, workItemId: item.id, expectedRevision,
      evidenceRefs: [{ ref }], operationId: `secret-evidence-${index}` });
    assert.equal(result.isError, true);
    assert.equal(JSON.stringify(result).includes('fictional-example-only'), false);
  }
  assert.deepEqual(f.repo.getWorkItem(projectId, item.id)?.evidenceRefs, []);
  assert.deepEqual(f.db.prepare('SELECT input_json FROM platform_action_intents WHERE user_id=?').all(f.userId), []);
  assert.deepEqual(f.db.prepare('SELECT result_json FROM copilot_operation_log WHERE user_id=?').all(f.userId), []);
  await f.ok('pm_attach_evidence', { projectId, workItemId: item.id, expectedRevision,
    evidenceRefs: [{ ref: 'https://example.test/task-packet/123' }], operationId: 'legitimate-evidence' });
  assert.equal(f.repo.getWorkItem(projectId, item.id)?.evidenceRefs[0]?.ref, 'https://example.test/task-packet/123');
});

test('direct lifecycle previews and credential-shaped operation IDs cannot bypass input admission', async t => {
  const f = await fixture(t), projectId = f.project.id;
  const actions = new PlatformActions({ db: f.db, userId: f.userId, mcpTokenId: f.grant.record.id }, createPlatformCommands());
  const expectedPlanDigest = (await f.readPlan()).planDigest;
  assert.throws(() => actions.preview({ commandId: 'mcp.lifecycle.pm_set_goal', idempotencyKey: 'direct-secret',
    input: { projectId, expectedPlanDigest, summary: 'sk-fictional-example-only' } }), /credential/i);
  const result = await f.call('pm_set_goal', { projectId, expectedPlanDigest: (await f.readPlan()).planDigest,
    summary: 'Safe goal', operationId: 'sk-fictional-operation-only' });
  assert.equal(result.isError, true);
  assert.deepEqual(f.db.prepare('SELECT input_json FROM platform_action_intents WHERE user_id=?').all(f.userId), []);
});

test('pending historical lifecycle intents with credential material cannot execute', async t => {
  const f = await fixture(t), projectId = f.project.id;
  const actions = new PlatformActions({ db: f.db, userId: f.userId, mcpTokenId: f.grant.record.id }, createPlatformCommands());
  const input = { projectId, expectedPlanDigest: (await f.readPlan()).planDigest, summary: 'Safe goal' };
  const intent = actions.preview({ commandId: 'mcp.lifecycle.pm_set_goal', input, idempotencyKey: 'historical-secret' });
  // Recreate an approved intent written before the admission boundary existed.
  f.db.prepare('UPDATE platform_action_intents SET input_json=? WHERE id=? AND user_id=?')
    .run(JSON.stringify({ ...input, summary: 'sk-fictional-example-only' }), intent.id, f.userId);
  await assert.rejects(actions.execute(intent.id), /credential/i);
  assert.equal(f.repo.getGoal(projectId), undefined);
  assert.deepEqual(f.db.prepare('SELECT result_json FROM platform_action_receipts WHERE user_id=?').all(f.userId), []);
});

test('direct lifecycle actions enforce selected projects during preview and execution', async t => {
  const f = await fixture(t);
  const context = { db: f.db, userId: f.userId, mcpTokenId: f.grant.record.id };
  // No optional entry-point authorization callback: the shared command must enforce scope.
  const actions = new PlatformActions(context, createPlatformCommands());
  const unauthorizedInput = { projectId: f.other.id, expectedPlanDigest: planDigest(context, f.other.id), summary: 'Outside scope' };
  assert.throws(() => actions.preview({ commandId: 'mcp.lifecycle.pm_set_goal', input: unauthorizedInput,
    idempotencyKey: 'unselected-preview' }), /outside MCP token authorization/);
  assert.deepEqual(f.db.prepare('SELECT id FROM platform_action_intents WHERE user_id=?').all(f.userId), []);

  const input = { projectId: f.project.id, expectedPlanDigest: planDigest(context, f.project.id), summary: 'Selected project' };
  const pending = actions.preview({ commandId: 'mcp.lifecycle.pm_set_goal', input, idempotencyKey: 'legacy-unselected' });
  f.db.prepare('UPDATE platform_action_intents SET input_json=? WHERE id=? AND user_id=?')
    .run(JSON.stringify(unauthorizedInput), pending.id, f.userId);
  await assert.rejects(actions.execute(pending.id), /outside MCP token authorization/);
  assert.equal(f.repo.getGoal(f.other.id), undefined);

  const authorized = actions.preview({ commandId: 'mcp.lifecycle.pm_set_goal', input, idempotencyKey: 'selected-control' });
  const receipt = await actions.execute(authorized.id);
  assert.equal(receipt.outcome, 'confirmed');
  assert.equal(f.repo.getGoal(f.project.id)?.summary, input.summary);
});

test('lifecycle prose can describe unsafe input while references remain checked', async t => {
  const f = await fixture(t), projectId = f.project.id;
  const prose = 'Reject ../ path traversal; rm -rf /tmp/example';
  await f.ok('pm_set_goal', { projectId, expectedPlanDigest: (await f.readPlan()).planDigest,
    summary: prose, constraints: [prose], acceptanceCriteria: [prose], operationId: 'security-goal' });
  const stage = await f.ok('pm_manage_stage', { projectId, expectedPlanDigest: (await f.readPlan()).planDigest,
    action: 'create', name: 'Traversal ../ review', description: prose, operationId: 'security-stage' });
  const item = f.repo.createWorkItem(projectId, { title: 'Security task' });
  await f.ok('pm_update_task_plan', { projectId, workItemId: item.id, expectedRevision: f.repo.taskMetadata(projectId, item.id).revision,
    title: prose, description: prose, acceptanceCriteria: [prose], stageId: stage.id, operationId: 'security-plan' });
  assert.deepEqual(f.repo.getWorkItem(projectId, item.id)?.acceptanceCriteria, [prose]);
  const rejected = await f.call('pm_attach_evidence', { projectId, workItemId: item.id,
    expectedRevision: f.repo.taskMetadata(projectId, item.id).revision, evidenceRefs: [{ ref: '../secret' }], operationId: 'unsafe-ref' });
  assert.equal(rejected.isError, true);
  f.repo.updateWorkItemStatus(projectId, item.id, { status: 'in_progress' });
  f.repo.updateWorkItemStatus(projectId, item.id, { status: 'ready_for_review' });
  await f.ok('pm_review_task', { projectId, workItemId: item.id, expectedRevision: f.repo.taskMetadata(projectId, item.id).revision,
    decision: 'changes_requested', note: prose, operationId: 'security-review' });
  assert.equal(f.repo.getWorkItem(projectId, item.id)?.status, 'in_progress');
});

test('permanent and long-lived lifecycle tokens can discover and write; revocation still denies writes', async t => {
  const f = await fixture(t), projectId = f.project.id;
  for (const expiresAt of [null, Date.now() + 720 * 3600000]) {
    f.db.prepare('UPDATE mcp_access_tokens SET expires_at=? WHERE id=?').run(expiresAt === null ? null : Math.floor(expiresAt / 1000), f.grant.record.id);
    assert.ok((await f.list()).some(tool => tool.name === 'pm_set_goal'));
    const input = { projectId, expectedPlanDigest: (await f.readPlan()).planDigest, summary: `Lifetime ${expiresAt}`, operationId: `lifetime-${expiresAt}` };
    await f.ok('pm_set_goal', input);
    assert.equal(f.repo.getGoal(projectId)?.summary, input.summary);
  }
  f.db.prepare('UPDATE mcp_access_tokens SET expires_at=? WHERE id=?').run(Math.floor(Date.now() / 1000) - 60, f.grant.record.id);
  assert.equal(await f.authStatus(), 401);
  f.db.prepare('UPDATE mcp_access_tokens SET expires_at=NULL WHERE id=?').run(f.grant.record.id);
  const context = { db: f.db, userId: f.userId, masterKey: 'x'.repeat(32), mcpTokenId: f.grant.record.id };
  const actions = new PlatformActions(context, createPlatformCommands());
  const input = { projectId, expectedPlanDigest: (await f.readPlan()).planDigest, summary: 'Must not change' };
  const intent = actions.preview({ commandId: 'mcp.lifecycle.pm_set_goal', input, idempotencyKey: 'revoke-permanent' });
  f.tokens.revokeByIdAndUser(f.grant.record.id, f.userId);
  await assert.rejects(actions.execute(intent.id), /AUTHORITY|expired or revoked/);
  assert.notEqual(f.repo.getGoal(projectId)?.summary, input.summary);
});

test('MCP lifecycle closes planning, dependency, review rejection and declared acceptance with durable retries', async t => {
  const f = await fixture(t); const projectId = f.project.id;
  const initial = await f.readPlan();
  const goalInput = { projectId, expectedPlanDigest: initial.planDigest, summary: 'Repair lifecycle', operationId: 'goal' };
  const goal = await f.ok('pm_set_goal', goalInput);
  assert.deepEqual(await f.ok('pm_set_goal', goalInput), goal);
  const oldSnapshot = await f.call('pm_manage_stage', { projectId, expectedPlanDigest: initial.planDigest, action: 'create', name: 'bad', operationId: 'stale-stage' });
  assert.equal(oldSnapshot.isError, true);
  const next = await f.readPlan();
  const stage = await f.ok('pm_manage_stage', { projectId, expectedPlanDigest: next.planDigest, action: 'create', name: 'Validation', operationId: 'stage' });
  const item = f.repo.createWorkItem(projectId, { title: 'Tests', acceptanceCriteria: ['Bound token', 'Do not persist terminal output'] });
  const blocker = f.repo.createWorkItem(projectId, { title: 'Design' });
  let expectedRevision = f.repo.taskMetadata(projectId, item.id).revision;
  await f.ok('pm_update_task_plan', { projectId, workItemId: item.id, expectedRevision, stageId: stage.id, operationId: 'criteria' });
  let plan = await f.readPlan();
  await f.ok('pm_manage_dependency', { projectId, workItemId: item.id, blockerWorkItemId: blocker.id, expectedPlanDigest: plan.planDigest, action: 'add', operationId: 'dependency' });
  plan = await f.readPlan();
  assert.equal((await f.call('pm_manage_dependency', { projectId, workItemId: blocker.id, blockerWorkItemId: item.id, expectedPlanDigest: plan.planDigest, action: 'add', operationId: 'cycle' })).isError, true);
  await f.ok('pm_manage_dependency', { projectId, workItemId: item.id, blockerWorkItemId: blocker.id, expectedPlanDigest: plan.planDigest, action: 'remove', operationId: 'remove-dependency' });
  f.repo.updateWorkItemStatus(projectId, item.id, { status: 'in_progress' });
  f.repo.updateWorkItemStatus(projectId, item.id, { status: 'ready_for_review' });
  expectedRevision = f.repo.taskMetadata(projectId, item.id).revision;
  await f.ok('pm_review_task', { projectId, workItemId: item.id, expectedRevision, decision: 'changes_requested', note: 'Add expiry check', operationId: 'reject' });
  assert.equal(f.repo.getWorkItem(projectId, item.id)?.status, 'in_progress');
  f.repo.updateWorkItemStatus(projectId, item.id, { status: 'ready_for_review' });
  expectedRevision = f.repo.taskMetadata(projectId, item.id).revision;
  await f.ok('pm_attach_evidence', { projectId, workItemId: item.id, expectedRevision, evidenceRefs: [{ kind: 'test_report', ref: 'tests/expiry' }], operationId: 'evidence' });
  expectedRevision = f.repo.taskMetadata(projectId, item.id).revision;
  const acceptance = { projectId, workItemId: item.id, expectedRevision, decision: 'accepted', note: 'Reviewed', operationId: 'accept', criteria: [{ index: 0, evidenceRef: 'tests/expiry' }, { index: 1, evidenceRef: 'tests/expiry' }] };
  assert.equal((await f.call('pm_review_task', { ...acceptance, operationId: 'missing-criterion', criteria: acceptance.criteria.slice(0, 1) })).isError, true);
  const accepted = await f.ok('pm_review_task', acceptance);
  assert.deepEqual(await f.ok('pm_review_task', acceptance), accepted);
  assert.equal(accepted.completionSource, 'operator_declared');
  assert.equal(f.repo.getWorkItem(projectId, item.id)?.status, 'done');
  assert.equal((await f.call('pm_update_task_plan', { projectId, workItemId: item.id,
    expectedRevision: f.repo.taskMetadata(projectId, item.id).revision, acceptanceCriteria: ['Unreviewed new criterion'], operationId: 'change-accepted' })).isError, true);
  assert.deepEqual(f.repo.getWorkItem(projectId, item.id)?.acceptanceCriteria, ['Bound token', 'Do not persist terminal output']);
  const handoff = await f.ok('pm_get_handoff', { projectId, workItemId: item.id });
  assert.equal(handoff.gitIntegration, 'not_verified');
  assert.equal(handoff.deployment, 'not_verified');
  const deleted = await f.ok('pm_delete_work_item', { projectId, workItemId: blocker.id, expectedRevision: f.repo.taskMetadata(projectId, blocker.id).revision, confirm: true, operationId: 'cleanup' });
  assert.equal(deleted.deleted, true); assert.equal(f.repo.getWorkItem(projectId, blocker.id), undefined);
});

test('large legal planning and handoff responses keep usable top-level digests and pagination', async t => {
  const f = await fixture(t), projectId = f.project.id;
  f.repo.upsertGoal(projectId, { summary: 'Goal', constraints: Array.from({ length: 50 }, (_, i) => `${i}:${'x'.repeat(990)}`) });
  for (let i = 0; i < 201; i++) f.repo.createWorkItem(projectId, { title: `${i}:` + '界'.repeat(240) });
  const plan = await f.readPlan();
  assert.equal(typeof plan.planDigest, 'string'); assert.notEqual(plan.truncated, true);
  assert.ok((plan.tasks as unknown[]).length <= 50); assert.equal(plan.nextOffset, 50);
  const page = await f.ok('pm_get_plan', { projectId, offset: 200, limit: 50 });
  assert.equal((page.tasks as unknown[]).length, 1); assert.equal(page.planDigest, plan.planDigest);
  const item = f.repo.createWorkItem(projectId, { title: 'Large handoff', acceptanceCriteria: Array.from({ length: 50 }, (_, i) => `${i}:${'界'.repeat(990)}`) });
  const handoff = await f.ok('pm_get_handoff', { projectId, workItemId: item.id });
  assert.equal(handoff.workItemId, item.id); assert.equal(handoff.nextOffset, 5); assert.notEqual(handoff.truncated, true);
});

test('lifecycle requires current scoped permission and stable write IDs; old tokens retain their powers', async t => {
  const f = await fixture(t); const plan = await f.readPlan();
  const input = { projectId: f.project.id, expectedPlanDigest: plan.planDigest, summary: 'No escalation', operationId: 'goal' };
  assert.equal((await f.call('pm_set_goal', input, f.old.token)).isError, true);
  const { operationId: _excluded, ...withoutId } = input;
  assert.equal((await f.call('pm_set_goal', withoutId)).isError, true);
  assert.equal((await f.call('pm_set_goal', { ...input, projectId: f.other.id })).isError, true);
  f.db.prepare('UPDATE mcp_access_tokens SET scopes=? WHERE id=?').run(JSON.stringify(['read', 'operate']), f.grant.record.id);
  assert.equal((await f.call('pm_set_goal', input)).isError, true);
  assert.equal(f.repo.getGoal(f.project.id), undefined);
});

test('reserved verification evidence and governed project acceptance cannot be forged', async t => {
  const f = await fixture(t); const projectId = f.project.id;
  const item = f.repo.createWorkItem(projectId, { title: 'Guard', acceptanceCriteria: ['Criterion'] });
  let expectedRevision = f.repo.taskMetadata(projectId, item.id).revision;
  assert.equal((await f.call('pm_attach_evidence', { projectId, workItemId: item.id, expectedRevision, evidenceRefs: [{ kind: 'verified', ref: 'invented' }], operationId: 'forge' })).isError, true);
  f.repo.updateWorkItemStatus(projectId, item.id, { status: 'in_progress' });
  f.repo.updateWorkItemStatus(projectId, item.id, { status: 'ready_for_review' });
  // Enabling governed execution must immediately remove legacy declared completion authority.
  f.db.prepare("INSERT INTO collaboration_members (user_id,project_id,member_id,role,state,revision) VALUES (?,?,?,'developer','active',1)")
    .run(f.userId, projectId, f.userId);
  expectedRevision = f.repo.taskMetadata(projectId, item.id).revision;
  const result = await f.call('pm_review_task', { projectId, workItemId: item.id, expectedRevision, decision: 'accepted', note: 'Forged', criteria: [{ index: 0, evidenceRef: 'invented' }], operationId: 'governed' });
  assert.equal(result.isError, true); assert.equal(f.repo.getWorkItem(projectId, item.id)?.status, 'ready_for_review');
});

test('an owner API context cannot execute an unconsumed MCP lifecycle intent', async t => {
  const f = await fixture(t), projectId = f.project.id;
  const context = { db: f.db, userId: f.userId, masterKey: 'x'.repeat(32) };
  const actions = new PlatformActions({ ...context, mcpTokenId: f.grant.record.id }, createPlatformCommands());
  const input = { projectId, expectedPlanDigest: (await f.readPlan()).planDigest, summary: 'Pending' };
  const intent = actions.preview({ commandId: 'mcp.lifecycle.pm_set_goal', input, idempotencyKey: 'pending-mcp' });
  const owner = new PlatformActions({ ...context, actionOrigin: { kind: 'owner_api' } }, createPlatformCommands());
  await assert.rejects(owner.execute(intent.id), /MCP_LIFECYCLE_AUTHORITY_REQUIRED/);
  assert.equal(f.repo.getGoal(projectId), undefined);
});

test('incomplete dependency blocks acceptance even with full declared criterion coverage', async t => {
  const f = await fixture(t), projectId = f.project.id;
  const blocker = f.repo.createWorkItem(projectId, { title: 'Unfinished' });
  const item = f.repo.createWorkItem(projectId, { title: 'Review', acceptanceCriteria: ['Covered'], evidenceRefs: [{ ref: 'tests/report' }] });
  f.repo.addWorkItemDependency(projectId, item.id, blocker.id);
  f.repo.updateWorkItemStatus(projectId, item.id, { status: 'in_progress' });
  f.repo.updateWorkItemStatus(projectId, item.id, { status: 'ready_for_review' });
  const result = await f.call('pm_review_task', { projectId, workItemId: item.id, expectedRevision: f.repo.taskMetadata(projectId, item.id).revision,
    decision: 'accepted', note: 'Reviewed', criteria: [{ index: 0, evidenceRef: 'tests/report' }], operationId: 'blocked-acceptance' });
  assert.equal(result.isError, true); assert.match(result.content[0]!.text, /DEPENDENCIES_NOT_DONE/);
  assert.equal(f.repo.getWorkItem(projectId, item.id)?.status, 'ready_for_review');
});

for (const status of ['done', 'cancelled'] as const) for (const action of ['add', 'remove'] as const)
  test(`final ${status} task refuses dependency ${action} without changing its graph`, async t => {
    const f = await fixture(t), projectId = f.project.id;
    const blocker = f.repo.createWorkItem(projectId, { title: 'Dependency' });
    const item = f.repo.createWorkItem(projectId, { title: 'Final task', acceptanceCriteria: ['Covered'], evidenceRefs: [{ ref: 'tests/report' }] });
    if (action === 'remove') {
      f.repo.updateWorkItemStatus(projectId, blocker.id, { status: 'in_progress' });
      f.repo.updateWorkItemStatus(projectId, blocker.id, { status: 'done', manualCompletionReason: 'Dependency checked' });
      f.repo.addWorkItemDependency(projectId, item.id, blocker.id);
    }
    if (status === 'done') {
      f.repo.updateWorkItemStatus(projectId, item.id, { status: 'in_progress' });
      f.repo.updateWorkItemStatus(projectId, item.id, { status: 'ready_for_review' });
      await f.ok('pm_review_task', { projectId, workItemId: item.id, expectedRevision: f.repo.taskMetadata(projectId, item.id).revision,
        decision: 'accepted', note: 'Reviewed', criteria: [{ index: 0, evidenceRef: 'tests/report' }], operationId: 'accept-final' });
    } else f.repo.updateWorkItemStatus(projectId, item.id, { status: 'cancelled' });
    const before = await f.readPlan(), links = f.repo.listWorkItemLinks(projectId);
    const result = await f.call('pm_manage_dependency', { projectId, workItemId: item.id, blockerWorkItemId: blocker.id,
      expectedPlanDigest: before.planDigest, action, operationId: `final-${status}-${action}` });
    assert.equal(result.isError, true); assert.match(result.content[0]!.text, /FINAL_TASK_PLAN_IMMUTABLE/);
    assert.deepEqual(f.repo.listWorkItemLinks(projectId), links);
    assert.equal((await f.readPlan()).planDigest, before.planDigest);
    assert.equal(f.repo.getWorkItem(projectId, item.id)?.status, status);
  });

for (const mode of ['live', 'unknown', 'restart-race', 'binding-race', 'scope-removed', 'revoked', 'confirmed'] as const) test(`task cleanup protects ${mode} runtime identity`, async t => {
  const f = await fixture(t), projectId = f.project.id, sessions = new SessionRepository(f.db, f.userId);
  const item = f.repo.createWorkItem(projectId, { title: 'Cleanup' });
  const session = sessions.create({ projectId, name: 'owned', aiTool: 'codex', workingDir: f.project.path });
  sessions.update(session.id, { status: 'stopped', runtimeSessionName: 'fb-cleanup-runtime' });
  f.repo.updateWorkItem(projectId, item.id, { details: withTaskPacketSessionLink(item.details, sessions.getById(session.id)!, f.project) });
  const confirmations = new SessionRuntimeConfirmationRepository(f.db, f.userId);
  const generation = { runtimeName: 'fb-cleanup-runtime', launchNonce: randomUUID(), daemon: { pid: 123, startedAt: new Date().toISOString() } };
  if (mode !== 'unknown') { confirmations.begin(session.id, generation); confirmations.confirm(session.id, generation.launchNonce, { ...generation, stopped: true }); }
  if (mode === 'live') f.runtimes.add(generation.runtimeName);
  if (mode === 'restart-race') f.duringProbe(() => { sessions.update(session.id, { attachToken: 'replacement', status: 'running' }); });
  if (mode === 'binding-race') {
    const replacement = sessions.create({ projectId, name: 'replacement', aiTool: 'codex', workingDir: f.project.path });
    f.duringProbe(() => { f.repo.updateWorkItem(projectId, item.id, { details: withTaskPacketSessionLink(item.details, replacement, f.project) }); });
  }
  if (mode === 'scope-removed') f.duringProbe(() => { f.db.prepare('UPDATE mcp_access_tokens SET scopes=? WHERE id=?').run(JSON.stringify(['read', 'operate']), f.grant.record.id); });
  if (mode === 'revoked') f.duringProbe(() => { f.tokens.revokeByIdAndUser(f.grant.record.id, f.userId); });
  const result = await f.call('pm_delete_work_item', { projectId, workItemId: item.id,
    expectedRevision: f.repo.taskMetadata(projectId, item.id).revision, confirm: true, operationId: `cleanup-${mode}` });
  if (mode === 'confirmed') { assert.notEqual(result.isError, true, result.content[0]!.text); assert.equal(f.repo.getWorkItem(projectId, item.id), undefined); }
  else { assert.equal(result.isError, true); assert.ok(f.repo.getWorkItem(projectId, item.id)); }
  if (mode === 'binding-race') assert.notEqual((f.repo.getWorkItem(projectId, item.id)?.details.taskPacket as { sessionId: string }).sessionId, session.id);
});

test('native owner/Copilot contexts run planning edits without a token but never acceptance or deletion', async t => {
  const f = await fixture(t), projectId = f.project.id;
  const context = { db: f.db, userId: f.userId, masterKey: 'x'.repeat(32) };
  const owner = new PlatformActions({ ...context, actionOrigin: { kind: 'owner_api' } }, createPlatformCommands());
  const goalInput = { projectId, expectedPlanDigest: planDigest({ ...context } as never, projectId), summary: 'Native plan' };
  const intent = owner.preview({ commandId: 'mcp.lifecycle.pm_set_goal', input: goalInput, idempotencyKey: 'native-goal' });
  await owner.execute(intent.id);
  assert.equal(f.repo.getGoal(projectId)?.summary, 'Native plan');

  const item = f.repo.createWorkItem(projectId, { title: 'Review me', acceptanceCriteria: ['Covered'], evidenceRefs: [{ ref: 'tests/report' }] });
  f.repo.updateWorkItemStatus(projectId, item.id, { status: 'in_progress' });
  f.repo.updateWorkItemStatus(projectId, item.id, { status: 'ready_for_review' });
  const revision = f.repo.taskMetadata(projectId, item.id).revision;
  for (const [commandId, input] of [
    ['mcp.lifecycle.pm_review_task', { projectId, workItemId: item.id, expectedRevision: revision, decision: 'accepted', note: 'ok', criteria: [{ index: 0, evidenceRef: 'tests/report' }] }],
    ['mcp.lifecycle.pm_delete_work_item', { projectId, workItemId: item.id, expectedRevision: revision, confirm: true }]
  ] as const) {
    assert.throws(() => owner.preview({ commandId, input, idempotencyKey: `native-${commandId}` }), /PM_LIFECYCLE_OWNER_ONLY/);
  }
  assert.equal(f.repo.getWorkItem(projectId, item.id)?.status, 'ready_for_review');
  // A context with no origin at all (neither Copilot nor owner API) gets no native authority.
  const anonymous = new PlatformActions(context, createPlatformCommands());
  assert.throws(() => anonymous.preview({ commandId: 'mcp.lifecycle.pm_set_goal',
    input: { ...goalInput, expectedPlanDigest: planDigest({ ...context } as never, projectId), summary: 'x' }, idempotencyKey: 'anon' }), /MCP_LIFECYCLE_AUTHORITY_REQUIRED/);
});

test('native Copilot tool surface carries plan edits; acceptance and deletion stay MCP-only', async () => {
  const { createPlatformTools } = await import('../src/services/agent/tools/index.js');
  const names = new Set(createPlatformTools().map(tool => tool.name));
  for (const name of ['pm_get_plan', 'pm_get_handoff', 'pm_set_goal', 'pm_update_task_plan', 'pm_manage_stage', 'pm_manage_dependency', 'pm_attach_evidence'])
    assert.ok(names.has(name), name);
  for (const name of ['pm_review_task', 'pm_delete_work_item']) assert.equal(names.has(name), false, name);
});

test('task packet dispatch refuses a task whose blockers are not done', async t => {
  const f = await fixture(t), projectId = f.project.id;
  const blocker = f.repo.createWorkItem(projectId, { title: 'Schema first' });
  const item = f.repo.createWorkItem(projectId, { title: 'API on top' });
  f.repo.addWorkItemDependency(projectId, item.id, blocker.id);
  const { assertTaskDependenciesResolved } = await import('../src/services/project-manager/task-execution.js');
  assert.throws(() => assertTaskDependenciesResolved(f.repo, f.repo.getWorkItem(projectId, item.id)!), /TASK_DEPENDENCIES_NOT_DONE: finish "Schema first" \(todo\)/);
  f.repo.updateWorkItemStatus(projectId, blocker.id, { status: 'cancelled' });
  assert.doesNotThrow(() => assertTaskDependenciesResolved(f.repo, f.repo.getWorkItem(projectId, item.id)!), 'a cancelled blocker no longer gates');
});

test('a cancelled blocker no longer gates acceptance, matching the dispatch gate', async t => {
  const f = await fixture(t), projectId = f.project.id;
  const blocker = f.repo.createWorkItem(projectId, { title: 'Dropped prerequisite' });
  const item = f.repo.createWorkItem(projectId, { title: 'Review', acceptanceCriteria: ['Covered'], evidenceRefs: [{ ref: 'tests/report' }] });
  f.repo.addWorkItemDependency(projectId, item.id, blocker.id);
  f.repo.updateWorkItemStatus(projectId, blocker.id, { status: 'cancelled' });
  f.repo.updateWorkItemStatus(projectId, item.id, { status: 'in_progress' });
  f.repo.updateWorkItemStatus(projectId, item.id, { status: 'ready_for_review' });
  await f.ok('pm_review_task', { projectId, workItemId: item.id, expectedRevision: f.repo.taskMetadata(projectId, item.id).revision,
    decision: 'accepted', note: 'Reviewed', criteria: [{ index: 0, evidenceRef: 'tests/report' }], operationId: 'cancelled-blocker-acceptance' });
  assert.equal(f.repo.getWorkItem(projectId, item.id)?.status, 'done');
});
