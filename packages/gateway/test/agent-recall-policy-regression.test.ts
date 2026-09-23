import assert from 'node:assert/strict';
import { it } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { AgentMemoryRepository } from '../src/services/agent/memory.js';
import { CopilotConversationLog } from '../src/services/agent/conversation-log.js';
import { createSecurityPolicy } from '../src/services/agent/security-policy.js';

it('considers session and project memories before a full global recall quota', () => {
  const db = new Database(':memory:');
  try {
    migrate(drizzle(db), { migrationsFolder: new URL('../src/db/migrations', import.meta.url).pathname });
    const user = new UserRepository(db).create('recall-fair@example.test', 'hash');
    const project = new ProjectRepository(db, user.id).create({ name: 'Recall', path: '/tmp/recall', aiTool: 'claude' });
    const conversation = new CopilotConversationLog(db, user.id).createConversation();
    const memory = new AgentMemoryRepository(db, user.id);
    for (let i = 0; i < 4; i++) memory.create({ scope: 'global', kind: 'fact', text: `deployment global ${i}` });
    const scoped = memory.create({ scope: 'project', projectId: project.id, kind: 'decision', text: 'deployment requires verified tests' });
    const current = memory.create({ scope: 'session', conversationId: conversation.id, kind: 'decision', text: 'deployment is currently paused' });
    const rows = memory.searchMulti([{ scope: 'global' }, { scope: 'project', projectId: project.id }, { scope: 'session', conversationId: conversation.id }], 'deployment', 3);
    assert.equal(rows.length, 3);
    assert.ok(rows.some(row => row.id === scoped.id));
    assert.ok(rows.some(row => row.id === current.id));
    assert.equal(new Set(rows.map(row => row.id)).size, 3);
    assert.throws(() => memory.searchMulti([{ scope: 'global' }, { scope: 'session', conversationId: 'missing' }], 'deployment', 1));
  } finally { db.close(); }
});

it('treats governed descriptive fields as data while still checking executable fields', () => {
  const policy = createSecurityPolicy();
  const evaluate = (toolName: string, input: unknown) => policy.evaluate({ userId: 'fixture', toolName, toolRisk: 'operate', requiresApproval: true, input });
  assert.equal(evaluate('write_memory', { scope: 'global', kind: 'fact', text: 'Imports use ../utils; never run rm -rf here.' }).action, 'require_approval');
  assert.equal(evaluate('pm_create_work_item', { projectId: 'p', title: 'Fix ../utils import', description: 'Document ../shared usage', acceptanceCriteria: ['Import ../utils works'] }).action, 'auto_approve');
  assert.equal(evaluate('create_project', { path: '/tmp/../etc', description: 'ordinary prose' }).action, 'deny');
  assert.equal(evaluate('read_skill_resource', { path: '../outside', skillId: 's', revisionId: 'r' }).action, 'deny');
  assert.equal(evaluate('write_memory', { scope: 'global', text: 'safe', metadata: { command: 'rm -rf /tmp/a' } }).action, 'deny');
  assert.equal(evaluate('unregistered_tool', { text: '../outside' }).action, 'deny');
  assert.equal(evaluate('mcp_external', { description: '../outside' }).action, 'deny');
});
