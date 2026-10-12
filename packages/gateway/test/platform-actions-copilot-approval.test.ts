import assert from 'node:assert/strict';
import { it } from 'node:test';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { CopilotToolPreferenceRepository } from '../src/db/repositories/copilot-tool-preference-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { PlatformActions, PlatformApprovalExpiredError } from '../src/services/platform-commands/actions.js';
import { createPlatformCommands, memoryWriteInput } from '../src/services/platform-commands/catalog.js';

function fixture(scope: 'project' | 'session' = 'project', normalizeInput = false) {
    const db = new Sqlite(':memory:');
    migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
    const user = new UserRepository(db).create('approval-actions@test.dev', 'hash');
    const projects = new ProjectRepository(db, user.id);
    const project = projects.create({ name: 'Approval', path: '/private/tmp/approval-action-project', aiTool: 'claude' });
    const ledger = new CopilotRunLedger(db, user.id);
    const conversation = ledger.log.createConversation();
    const runId = ledger.admit({ userId: user.id, conversationId: conversation.id, userText: 'Remember' }, 8);
    const toolInput = { kind: 'fact', scope, text: normalizeInput ? '  Approval fact  ' : 'Approval fact', ...(scope === 'project' ? { projectId: project.id } : {}) };
    const step = ledger.addStep(runId, { kind: 'tool', toolName: 'write_memory', toolCallId: 'call-memory', inputJson: JSON.stringify(toolInput), effect: 'write' });
    const commands = createPlatformCommands();
    if (normalizeInput) commands.get('memory.write')!.inputSchema = memoryWriteInput.extend({ text: z.string().trim(), metadata: z.record(z.unknown()).default({}) });
    const actions = new PlatformActions({ db, userId: user.id, actionOrigin: { kind: 'copilot', runId, stepId: step.id } }, commands);
    const input = { ...toolInput, ...(scope === 'session' ? { conversationId: conversation.id } : {}) };
    const intent = actions.preview({ commandId: 'memory.write', input, idempotencyKey: step.id });
    const claim = ledger.claim(runId, 'approval-test-worker', 30_000)!;
    ledger.waitApproval(claim, step);
    const pending = ledger.log.listPendingActions(runId)[0]!;
    const request = { runId, stepId: step.id, pendingActionId: pending.id, commandId: 'memory.write', input,
        inputDigest: step.input_digest!, source: 'user' as const, refreshExpiry: true };
    const approve = (override: Partial<typeof request> = {}) => db.transaction(() => {
        const refreshed = actions.revalidateCopilotApproval({ ...request, ...override });
        assert.equal(ledger.decide(runId, pending.id, true), true);
        return refreshed;
    }).immediate();
    return { db, user, project, projects, ledger, conversation, runId, step, actions, input, intent, pending, request, approve };
}

it('refreshes only the expired original unexecuted intent during exact approval, then executes once', async () => {
    const f = fixture();
    try {
        f.db.prepare('UPDATE platform_action_intents SET expires_at=0 WHERE id=?').run(f.intent.id);
        const refreshed = f.approve();
        assert.equal(refreshed.id, f.intent.id);
        for (const field of ['digest', 'resources_json', 'input_json', 'origin_run_id', 'origin_step_id', 'policy_version'] as const)
            assert.equal(refreshed[field], f.intent[field]);
        assert.ok(refreshed.expires_at > Date.now());
        assert.ok(refreshed.expires_at <= Date.now() + 15 * 60_000);
        assert.throws(() => f.approve(), /approval|pending|awaiting/i);
        assert.equal(f.actions.intents.get(f.intent.id)?.expires_at, refreshed.expires_at);
        assert.equal((await f.actions.execute(f.intent.id)).outcome, 'confirmed');
        assert.equal((await f.actions.execute(f.intent.id)).outcome, 'confirmed');
        assert.equal(f.db.prepare('SELECT count(*) AS n FROM copilot_memory').get().n, 1);
        assert.equal(f.db.prepare('SELECT count(*) AS n FROM platform_action_intents').get().n, 1);
    } finally { f.db.close(); }
});

it('channel approval preserves the original expiry and refuses an expired intent', () => {
    const f = fixture();
    try {
        const checked = f.db.transaction(() => f.actions.revalidateCopilotApproval({ ...f.request, refreshExpiry: false })).immediate();
        assert.equal(checked.expires_at, f.intent.expires_at);
        f.db.prepare('UPDATE platform_action_intents SET expires_at=0 WHERE id=?').run(f.intent.id);
        assert.throws(() => f.approve({ refreshExpiry: false }), (error: unknown) => {
            assert.ok(error instanceof PlatformApprovalExpiredError, `expected typed expiry denial, got ${error}`);
            assert.match((error as Error).message, /^PLATFORM_APPROVAL_EXPIRED/);
            return true;
        });
        assert.equal(f.ledger.log.getPendingAction(f.pending.id)?.status, 'pending');
        assert.equal(f.ledger.get(f.runId)?.status, 'awaiting_approval');
        assert.equal(f.actions.intents.receipt(f.intent.id), undefined);
        assert.equal(f.actions.intents.get(f.intent.id)?.status, 'approved');
        assert.equal(f.actions.intents.get(f.intent.id)?.expires_at, 0);
        assert.equal(f.db.prepare('SELECT count(*) AS n FROM copilot_memory').get().n, 0);
    } finally { f.db.close(); }
});

it('web approval on an expired intent still renews and executes', async () => {
    const f = fixture();
    try {
        f.db.prepare('UPDATE platform_action_intents SET expires_at=0 WHERE id=?').run(f.intent.id);
        const refreshed = f.approve({ refreshExpiry: true });
        assert.ok(refreshed.expires_at > Date.now());
        assert.equal((await f.actions.execute(f.intent.id)).outcome, 'confirmed');
        assert.equal(f.db.prepare('SELECT count(*) AS n FROM copilot_memory').get().n, 1);
    } finally { f.db.close(); }
});

it('compares normalized command input while preserving exact raw tool digests and original approved inputs', async () => {
    const f = fixture('project', true);
    try {
        assert.equal(JSON.parse(f.intent.input_json).text, 'Approval fact');
        assert.deepEqual(JSON.parse(f.intent.input_json).metadata, {});
        assert.throws(() => f.approve({ input: { ...f.input, text: 'Other fact' } }), /canonical input mismatch/);
        const refreshed = f.approve();
        assert.equal(refreshed.input_json, f.intent.input_json);
        assert.equal(refreshed.digest, f.intent.digest);
        assert.equal(f.ledger.steps(f.runId)[0]?.input_digest, f.step.input_digest);
        assert.equal((await f.actions.execute(f.intent.id)).outcome, 'confirmed');
    } finally { f.db.close(); }
});

for (const change of ['actor', 'tool', 'resource', 'channel', 'source', 'origin', 'digest', 'input', 'command', 'pending-input', 'policy'] as const) {
    it(`does not revive an expired intent after ${change} authority/input changes`, () => {
        const f = fixture();
        try {
            f.db.prepare('UPDATE platform_action_intents SET expires_at=0 WHERE id=?').run(f.intent.id);
            if (change === 'actor') f.db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(f.user.id);
            if (change === 'tool') new CopilotToolPreferenceRepository(f.db, f.user.id).setEnabled('write_memory', false);
            if (change === 'resource') f.projects.updateMetadata(f.project.id, { name: 'Changed' });
            if (change === 'channel') f.db.prepare('UPDATE copilot_conversations SET channel_owned=1 WHERE id=?').run(f.conversation.id);
            if (change === 'source') f.db.prepare("UPDATE copilot_runs SET source='scheduled' WHERE id=?").run(f.runId);
            if (change === 'origin') f.db.prepare('UPDATE platform_action_intents SET origin_run_id=NULL WHERE id=?').run(f.intent.id);
            if (change === 'digest') f.db.prepare("UPDATE platform_action_intents SET digest='tampered' WHERE id=?").run(f.intent.id);
            if (change === 'input') f.db.prepare('UPDATE platform_action_intents SET input_json=? WHERE id=?').run(JSON.stringify({ ...f.input, text: 'Other fact' }), f.intent.id);
            if (change === 'command') f.db.prepare("UPDATE platform_action_intents SET command_id='project.metadata.update' WHERE id=?").run(f.intent.id);
            if (change === 'pending-input') f.db.prepare('UPDATE copilot_pending_actions SET input_json=? WHERE id=?').run(JSON.stringify({ ...f.input, text: 'Other fact' }), f.pending.id);
            if (change === 'policy') f.db.prepare('UPDATE platform_action_intents SET policy_version=2 WHERE id=?').run(f.intent.id);
            assert.throws(() => f.approve());
            assert.equal(f.ledger.log.getPendingAction(f.pending.id)?.status, 'pending');
            assert.equal(f.actions.intents.get(f.intent.id)?.expires_at, 0);
            assert.equal(f.db.prepare('SELECT count(*) AS n FROM platform_action_intents').get().n, 1);
            assert.equal(f.db.prepare('SELECT count(*) AS n FROM copilot_memory').get().n, 0);
        } finally { f.db.close(); }
    });
}

for (const status of ['pending', 'rejected', 'executing', 'indeterminate', 'completed'] as const) {
    it(`refuses refresh of ${status} intents`, () => {
        const f = fixture();
        try {
            f.db.prepare('UPDATE platform_action_intents SET status=?,expires_at=0 WHERE id=?').run(status, f.intent.id);
            assert.throws(() => f.approve(), /approved|execut|replay/i);
            assert.equal(f.actions.intents.get(f.intent.id)?.expires_at, 0);
        } finally { f.db.close(); }
    });
}

for (const outcome of ['confirmed', 'no_effect', 'unknown'] as const) {
    it(`refuses refresh if any ${outcome} receipt exists, even if intent state was reset`, () => {
        const f = fixture();
        try {
            f.actions.intents.start(f.intent.id, 'test-owner', Date.now() + 30_000);
            f.actions.intents.finish(f.intent.id, outcome, { recorded: true });
            f.db.prepare("UPDATE platform_action_intents SET status='approved',expires_at=0 WHERE id=?").run(f.intent.id);
            assert.throws(() => f.approve(), /receipt|execut|replay/i);
            assert.equal(f.actions.intents.get(f.intent.id)?.expires_at, 0);
        } finally { f.db.close(); }
    });
}

it('requires the matching trusted origin, tenant, step, pending action and digest', () => {
    const f = fixture();
    try {
        const other = new UserRepository(f.db).create('other-approval-actions@test.dev', 'hash');
        const foreign = new PlatformActions({ db: f.db, userId: other.id, actionOrigin: { kind: 'copilot', runId: f.runId, stepId: f.step.id } }, createPlatformCommands());
        assert.throws(() => f.db.transaction(() => foreign.revalidateCopilotApproval(f.request)).immediate());
        const unbound = new PlatformActions({ db: f.db, userId: f.user.id }, createPlatformCommands());
        assert.throws(() => f.db.transaction(() => unbound.revalidateCopilotApproval(f.request)).immediate());
        assert.throws(() => f.approve({ runId: 'other-run' }));
        assert.throws(() => f.approve({ stepId: 'other-step' }));
        assert.throws(() => f.approve({ pendingActionId: 'other-action' }));
        assert.throws(() => f.approve({ inputDigest: 'other-digest' }));
        assert.equal(f.ledger.log.getPendingAction(f.pending.id)?.status, 'pending');
    } finally { f.db.close(); }
});

it('rolls expiry renewal back when the encompassing exact decision transaction fails', () => {
    const f = fixture();
    try {
        f.db.prepare('UPDATE platform_action_intents SET expires_at=0 WHERE id=?').run(f.intent.id);
        assert.throws(() => f.db.transaction(() => {
            f.actions.revalidateCopilotApproval(f.request);
            throw new Error('decision failed');
        }).immediate(), /decision failed/);
        assert.equal(f.actions.intents.get(f.intent.id)?.expires_at, 0);
    } finally { f.db.close(); }
});

it('session memory binds only the originating tenant conversation', async () => {
    const f = fixture('session');
    try {
        f.approve();
        assert.equal((await f.actions.execute(f.intent.id)).outcome, 'confirmed');
        const memory = f.db.prepare('SELECT user_id,scope,conversation_id,project_id FROM copilot_memory').get();
        assert.deepEqual(memory, { user_id: f.user.id, scope: 'session', conversation_id: f.conversation.id, project_id: null });
        assert.equal(JSON.parse(f.intent.resources_json).conversationId, f.conversation.id);
    } finally { f.db.close(); }
});

it('session resource exception does not permit another conversation, mixed scope, global or a forged context', () => {
    const f = fixture('session');
    try {
        const otherConversation = f.ledger.log.createConversation();
        const other = new UserRepository(f.db).create('foreign-memory-actions@test.dev', 'hash');
        const foreignConversation = new CopilotRunLedger(f.db, other.id).log.createConversation();
        for (const input of [{ ...f.input, conversationId: otherConversation.id }, { ...f.input, conversationId: foreignConversation.id },
            { ...f.input, projectId: f.project.id }, { ...f.input, scope: 'global' }]) {
            const step = f.ledger.addStep(f.runId, { kind: 'tool', toolName: 'write_memory', inputJson: JSON.stringify(input), effect: 'write' });
            const actions = new PlatformActions({ db: f.db, userId: f.user.id, conversationId: input.conversationId,
                actionOrigin: { kind: 'copilot', runId: f.runId, stepId: step.id } }, createPlatformCommands());
            assert.throws(() => actions.preview({ commandId: 'memory.write', input, idempotencyKey: step.id }));
        }
        const forged = new PlatformActions({ db: f.db, userId: f.user.id, conversationId: f.conversation.id,
            actionOrigin: { kind: 'copilot', runId: 'missing', stepId: 'missing' } }, createPlatformCommands());
        assert.throws(() => forged.preview({ commandId: 'memory.write', input: f.input, idempotencyKey: 'missing' }));
        const owner = new PlatformActions({ db: f.db, userId: f.user.id, actionOrigin: { kind: 'owner_api' } }, createPlatformCommands());
        const ownerIntent = owner.preview({ commandId: 'memory.write', input: { ...f.input, conversationId: otherConversation.id }, idempotencyKey: 'owner-other-session' });
        assert.equal(ownerIntent.status, 'approved');
        assert.equal(f.db.prepare('SELECT count(*) AS n FROM copilot_memory').get().n, 0);
    } finally { f.db.close(); }
});

for (const restriction of ['scheduled', 'research', 'review', 'repair'] as const) {
    it(`does not use session memory to bypass ${restriction} write restrictions`, async () => {
        const f = fixture('session');
        try {
            const turn = JSON.parse(f.ledger.get(f.runId)!.input_json) as Record<string, unknown>;
            if (restriction === 'scheduled') turn.source = restriction;
            else turn.executionMode = restriction;
            f.db.prepare('UPDATE copilot_runs SET source=?,input_json=? WHERE id=?')
                .run(restriction === 'scheduled' ? restriction : 'user', JSON.stringify(turn), f.runId);
            await assert.rejects(f.actions.execute(f.intent.id), /COPILOT_GLOBAL_ACTION_REQUIRES_WEB/);
            assert.equal(f.actions.intents.receipt(f.intent.id), undefined);
            assert.equal(f.db.prepare('SELECT count(*) AS n FROM copilot_memory').get().n, 0);
        } finally { f.db.close(); }
    });
}

it('does not revive session-memory authority after the originating conversation is deleted', async () => {
    const f = fixture('session');
    try {
        f.db.prepare("UPDATE copilot_conversations SET status='deleted' WHERE id=?").run(f.conversation.id);
        assert.throws(() => f.approve(), /pending/);
        await assert.rejects(f.actions.execute(f.intent.id), /originating conversation/);
        assert.equal(f.db.prepare('SELECT count(*) AS n FROM copilot_memory').get().n, 0);
    } finally { f.db.close(); }
});
