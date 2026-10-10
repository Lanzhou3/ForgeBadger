import { assertChannelConversationAuthority } from "../channels/channel-run-authority.js";
import { assertChannelRunScope, assertChannelToolScope } from '../channels/channel-run-scope.js';
import { PlatformNoEffectError } from "./errors.js";
import { TOOL_COMMANDS } from "./tool-commands.js";
import { CopilotToolPreferenceRepository } from "../../db/repositories/copilot-tool-preference-repository.js";
import { createSecurityPolicy } from "../agent/security-policy.js";
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { PlatformActionRepository, type ActionIntent } from '../../db/repositories/platform-action-repository.js';
import { validateProjectRoot, DENIED_ROOTS } from '../../lib/safe-resolve.js';
import type { CommandContext, PlatformCommand, CommandResources, CopilotApprovalRevalidation } from './types.js';
import type { TurnInput } from '../agent/run-ledger.js';
import { parseRunInput } from '../agent/run-authorization.js';
export function canonical(value: unknown): string {
    if (value instanceof Date)
        return JSON.stringify(value.toISOString());
    if (Array.isArray(value))
        return '[' + value.map(canonical).join(',') + ']';
    if (value !== null && typeof value === 'object')
        return '{' + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
    return JSON.stringify(value) ?? 'null';
}
export function canonicalRoot(value: string): string {
    const full = path.resolve(value);
    let ancestor = full;
    const tail: string[] = [];
    while (!existsSync(ancestor)) {
        tail.unshift(path.basename(ancestor));
        const parent = path.dirname(ancestor);
        if (parent === ancestor)
            throw new Error('Root unavailable');
        ancestor = parent;
    }
    const resolved = path.join(realpathSync(ancestor), ...tail);
    for (const denied of DENIED_ROOTS) {
        if (resolved === denied || (denied !== '/' && resolved.startsWith(denied + path.sep)))
            throw new Error('Denied project root');
    }
    if (existsSync(resolved))
        validateProjectRoot(resolved);
    return resolved;
}
const previewSchema = z.object({ commandId: z.string().min(1).max(100), input: z.unknown(), idempotencyKey: z.string().min(1).max(200) }).strict();
/** Loud terminal denial for approval decisions that reached an already-expired
 * intent the decision origin may not renew. Silence is not consent: the run is
 * left awaiting an explicit reject, never an approval that can never execute. */
export class PlatformApprovalExpiredError extends Error {
    constructor(message = 'PLATFORM_APPROVAL_EXPIRED: the action intent has already expired and a channel decision cannot renew it; reject this request and create a fresh one') {
        super(message);
        this.name = 'PlatformApprovalExpiredError';
    }
}
export class PlatformActions {
    readonly intents: PlatformActionRepository;
    constructor(readonly context: CommandContext, readonly commands: Map<string, PlatformCommand>) {
        this.intents = new PlatformActionRepository(context.db, context.userId);
        this.intents.recoverExpired();
    }
    private activeActor() {
        const user = this.context.db.prepare('SELECT status FROM users WHERE id=?').get(this.context.userId) as {
            status: string;
        } | undefined;
        if (user?.status !== 'active')
            throw new Error('Actor is not active');
    }
    private checkPolicy(c: PlatformCommand, input: unknown, origin: ActionIntent['origin_kind'] | undefined = this.context.actionOrigin?.kind) {
        const prefs = new CopilotToolPreferenceRepository(this.context.db, this.context.userId);
        if (origin === 'copilot' && Object.entries(TOOL_COMMANDS).some(([tool, command]) => command === c.id && !prefs.isEnabled(tool)))
            throw new Error("Tool disabled by owner");
        const toolName = Object.entries(TOOL_COMMANDS).find(([, id]) => id === c.id)?.[0] ?? c.id;
        const policyInput = c.id === 'project.create' && input && typeof input === 'object' && 'path' in input
            ? { ...input, path: canonicalRoot(String(input.path)) } : input;
        const decision = createSecurityPolicy().evaluate({ userId: this.context.userId, toolName, toolRisk: "operate", requiresApproval: true, input: policyInput });
        if (decision.action === "deny")
            throw new Error(`Denied by security policy: ${decision.reason}`);
        return decision;
    }
    private checkCopilotScope(origin: ActionIntent['origin_kind'] | undefined, resources: CommandResources,
        commandId: string, input: unknown, context = this.context, beforeExecution = true) {
        if (origin !== 'copilot') return;
        if (context.actionOrigin?.kind === 'copilot') this.checkChannelOrigin(context.actionOrigin.stepId, resources, commandId, input);
        let reason: string | undefined;
        if (!resources.projectIds.length && !this.isOriginSessionMemory(commandId, input, resources, context))
            reason = 'COPILOT_GLOBAL_ACTION_REQUIRES_WEB: 请在 Web 控制台手动执行';
        // An execution checkpoint can follow an earlier side effect. Only
        // admission/preflight is known to have made no changes.
        if (reason) throw beforeExecution ? new PlatformNoEffectError(reason) : new Error(reason);
    }
    private isOriginSessionMemory(commandId: string, input: unknown, resources: CommandResources, context: CommandContext): boolean {
        if (commandId !== 'memory.write' || !input || typeof input !== 'object') return false;
        const v = input as { scope?: string; projectId?: string; conversationId?: string };
        if (v.scope !== 'session' || v.projectId !== undefined || !v.conversationId
            || resources.conversationId !== v.conversationId || resources.rootPaths?.length) return false;
        const origin = context.actionOrigin;
        if (origin?.kind !== 'copilot') return false;
        const row = this.intents.copilotOrigin(origin.runId, origin.stepId);
        if (!row || row.conversation_id !== v.conversationId || !['pending', 'running', 'awaiting_approval'].includes(row.run_status)) return false;
        const turn = JSON.parse(row.run_input_json) as TurnInput;
        return turn.userId === this.context.userId && turn.conversationId === row.conversation_id
            && (turn.source ?? 'user') === row.source && row.source !== 'scheduled' && !turn.executionMode;
    }
    private originKind(intent: ActionIntent): ActionIntent['origin_kind'] {
        return intent.origin_kind === 'legacy' && this.intents.originConversation(intent.idempotency_key)
            ? 'copilot' : intent.origin_kind;
    }
    preview(raw: unknown): ActionIntent {
        this.activeActor();
        this.context.externalAuthorize?.();
        const v = previewSchema.parse(raw);
        const c = this.commands.get(v.commandId);
        if (!c)
            throw new Error('Unknown platform command');
        const input = c.inputSchema.parse(v.input);
        const previous = this.intents.byKey(v.idempotencyKey);
        this.checkPolicy(c, input, previous ? this.originKind(previous) : this.context.actionOrigin?.kind);
        if (previous) {
            if (previous.command_id !== c.id || previous.input_json !== canonical(input))
                throw new Error('Idempotency key conflicts with payload');
            this.context.externalAuthorize?.(JSON.parse(previous.resources_json) as CommandResources);
            this.checkChannelOrigin(previous.idempotency_key, JSON.parse(previous.resources_json) as CommandResources, c.id, input);
            this.checkCopilotScope(this.originKind(previous), JSON.parse(previous.resources_json) as CommandResources, c.id, input, this.commandContext(previous));
            return previous;
        }
        const resources = c.resolve(this.context, input);
        this.context.externalAuthorize?.(resources);
        this.checkCopilotScope(this.context.actionOrigin?.kind, resources, c.id, input);
        const digest = createHash('sha256').update(canonical({ commandId: c.id, input, resources, policyVersion: 1 })).digest('hex');
        return this.intents.create({ actor_user_id: this.context.userId, authority: 'owner_action', command_id: c.id, input_json: canonical(input), digest, resources_json: canonical(resources), policy_version: 1, expires_at: Date.now() + 15 * 60000, idempotency_key: v.idempotencyKey, status: 'approved' }, this.context.actionOrigin);
    }
    private checkChannelOrigin(key:string, resources?: CommandResources, commandId?: string, input?: unknown) {
        const conversationId=this.intents.originConversation(key);
        const step = this.context.db.prepare('SELECT r.id,r.input_json FROM copilot_runs r JOIN copilot_run_steps s ON s.user_id=r.user_id AND s.run_id=r.id WHERE s.user_id=? AND s.id=?')
            .get(this.context.userId, key) as { id: string; input_json: string } | undefined;
        if (!step) { if (conversationId) assertChannelConversationAuthority(this.context.db,this.context.userId,conversationId); return; }
        const turn = parseRunInput(step);
        const scope = assertChannelRunScope(this.context.db, this.context.userId, turn, resources);
        if (scope && commandId) {
            const name = Object.entries(TOOL_COMMANDS).find(([, command]) => command === commandId)?.[0];
            if (!name) throw new Error('CHANNEL_AUTHORITY_REJECTED');
            assertChannelToolScope({ db: this.context.db, userId: this.context.userId, masterKey: this.context.masterKey ?? '',
                runId: step.id, conversationId: turn.conversationId, source: turn.source ?? 'user',
                ...(turn.projectId ? { projectId: turn.projectId } : {}),
                ...(turn.executionMode ? { executionMode: turn.executionMode } : {}) }, name, input);
        }
    }
    private commandContext(i: ActionIntent): CommandContext {
        if (!['session.stop', 'memory.write'].includes(i.command_id) || this.originKind(i) !== 'copilot') return this.context;
        const step = this.context.db.prepare('SELECT id,run_id FROM copilot_run_steps WHERE user_id=? AND id=?')
            .get(this.context.userId, i.origin_step_id ?? i.idempotency_key) as { id: string; run_id: string } | undefined;
        if (!step || (i.origin_run_id && step.run_id !== i.origin_run_id)) throw new Error('Copilot command origin missing');
        return { ...this.context, actionOrigin: { kind: 'copilot', runId: step.run_id, stepId: step.id } };
    }
    private check(i: ActionIntent, allowExpired = false) {
        this.activeActor();
        this.context.externalAuthorize?.(JSON.parse(i.resources_json) as CommandResources);
        this.intents.assertOriginActive(i.idempotency_key);
        this.checkChannelOrigin(i.idempotency_key, JSON.parse(i.resources_json) as CommandResources, i.command_id, JSON.parse(i.input_json));
        if (i.status !== 'approved' || (!allowExpired && i.expires_at <= Date.now()) || i.policy_version !== 1)
            throw new Error('Action is not approved or has expired');
        const c = this.commands.get(i.command_id);
        if (!c)
            throw new Error('Command unavailable');
        const input = c.inputSchema.parse(JSON.parse(i.input_json));
        this.checkPolicy(c, input, this.originKind(i));
        const resources = c.resolve(this.commandContext(i), input);
        this.checkCopilotScope(this.originKind(i), resources, c.id, input, this.commandContext(i));
        this.context.externalAuthorize?.(resources);
        if (canonical(resources) !== i.resources_json)
            throw new Error('Stale resource revision');
        return { c, input };
    }
    /** Exact approval only: caller revalidates, then consumes the pending action in
     * the same immediate decision transaction. This never creates a replacement intent. */
    revalidateCopilotApproval(request: CopilotApprovalRevalidation): ActionIntent {
        if (!this.context.db.inTransaction) throw new Error('Approval revalidation requires a decision transaction');
        const origin = this.context.actionOrigin;
        if (origin?.kind !== 'copilot' || origin.runId !== request.runId || origin.stepId !== request.stepId)
            throw new Error('Copilot approval origin mismatch');
        const row = this.intents.copilotOrigin(request.runId, request.stepId);
        const pending = this.intents.pendingApproval(request.pendingActionId, request.runId, request.stepId);
        if (!row || row.run_status !== 'awaiting_approval' || row.step_status !== 'awaiting_approval' || !pending)
            throw new Error('Copilot approval is no longer pending');
        const turn = JSON.parse(row.run_input_json) as TurnInput;
        if (turn.userId !== this.context.userId || turn.conversationId !== row.conversation_id
            || request.source !== row.source || (turn.source ?? 'user') !== row.source)
            throw new Error('Copilot approval source identity mismatch');
        const digest = createHash('sha256').update(row.input_json).digest('hex');
        if (digest !== row.input_digest || request.inputDigest !== digest || pending.input_digest !== digest
            || pending.input_json !== row.input_json || pending.tool !== row.tool_name || pending.tool_call_id !== row.tool_call_id
            || TOOL_COMMANDS[row.tool_name] !== request.commandId)
            throw new Error('Copilot approval input or command mismatch');
        const i = this.intents.byKey(request.stepId);
        if (!i || i.origin_kind !== 'copilot' || i.origin_run_id !== request.runId || i.origin_step_id !== request.stepId
            || i.actor_user_id !== this.context.userId || i.authority !== 'owner_action' || i.command_id !== request.commandId)
            throw new Error('Copilot approval intent identity mismatch');
        if (i.status !== 'approved' || i.execution_owner !== null || i.execution_lease_expires_at !== null || this.intents.receipt(i.id))
            throw new Error('Action must be approved and unexecuted without a receipt; replay prohibited');
        const original = JSON.parse(row.input_json) as unknown;
        const platformInput = row.tool_name === 'write_memory' && original && typeof original === 'object' && 'scope' in original && original.scope === 'session'
            ? { ...original, conversationId: row.conversation_id } : original;
        const command = this.commands.get(i.command_id);
        if (!command) throw new Error('Command unavailable');
        const normalized = canonical(command.inputSchema.parse(request.input));
        if (normalized !== canonical(command.inputSchema.parse(platformInput)) || normalized !== i.input_json)
            throw new Error('Copilot approval canonical input mismatch');
        const expectedDigest = createHash('sha256').update(canonical({ commandId: i.command_id,
            input: JSON.parse(i.input_json), resources: JSON.parse(i.resources_json), policyVersion: i.policy_version })).digest('hex');
        if (i.digest !== expectedDigest) throw new Error('Copilot approval intent digest mismatch');
        if (!request.refreshExpiry && i.expires_at <= Date.now()) throw new PlatformApprovalExpiredError();
        this.check(i, request.refreshExpiry);
        if (request.refreshExpiry && !this.intents.refreshCopilotApproval(i, request.pendingActionId, Date.now() + 15 * 60_000))
            throw new Error('Copilot approval renewal conflict');
        return this.intents.get(i.id)!;
    }
    async execute(id: string) {
        this.context.externalAuthorize?.();
        const old = this.intents.receipt(id);
        if (old) {
            const prior = this.intents.get(id);
            if (prior) {
                this.context.externalAuthorize?.(JSON.parse(prior.resources_json) as CommandResources);
                this.checkChannelOrigin(prior.idempotency_key, JSON.parse(prior.resources_json) as CommandResources, prior.command_id, JSON.parse(prior.input_json));
            }
            return old;
        }
        const i = this.intents.get(id);
        if (!i)
            throw new Error('Action not found');
        if (i.status === 'executing' || i.status === 'indeterminate')
            throw new Error('Action effect indeterminate; automatic replay prohibited');
        const { c, input } = this.check(i);
        if (c.prepare)
            await c.prepare(this.commandContext(i), input);
        const preparedReceipt = this.intents.receipt(id);
        if(preparedReceipt) return preparedReceipt;
        if (c.effect === 'database') {
            try {
                return this.context.db.transaction(() => {
                    const fresh = this.intents.get(id)!;
                    const checked = this.check(fresh);
                    this.claim(fresh);
                    const result = checked.c.execute({ ...this.context, actionIntentId: id }, checked.input);
                    if (result instanceof Promise)
                        throw new Error('Database commands must be synchronous');
                    return this.intents.finish(id, 'confirmed', result);
                }).immediate();
            }
            catch (error) {
                // SQLite rolled back both mutation and budget. Persist a no-effect receipt separately.
                this.context.db.transaction(() => {
                    if (this.intents.transition(id, 'approved', 'executing'))
                        this.intents.finish(id, 'no_effect', { error: error instanceof Error ? error.message : 'Database action failed' });
                }).immediate();
                throw error;
            }
        }
        const checked = this.context.db.transaction(() => {
            const fresh = this.intents.get(id)!;
            const checked = this.check(fresh);
            const owner=this.claim(fresh);
            return {...checked,owner};
        }).immediate();
        const heartbeat=setInterval(()=>{
            if(!this.context.db.open){clearInterval(heartbeat);return;}
            try{this.intents.renewExecution(id,checked.owner,Date.now()+30_000);}catch{clearInterval(heartbeat);}
        },10_000);
        heartbeat.unref();
        let resourceBaseline = i.resources_json;
        const authorize = (checkRevision = true) => {
            this.activeActor();
            this.context.externalAuthorize?.(JSON.parse(i.resources_json) as CommandResources);
            this.intents.assertOriginActive(i.idempotency_key);
            this.checkChannelOrigin(i.idempotency_key, JSON.parse(i.resources_json) as CommandResources, i.command_id, JSON.parse(i.input_json));
            if (i.expires_at <= Date.now()) throw new Error('Action expired');
            this.intents.assertExecutionOwner(id, checked.owner);
            this.checkPolicy(checked.c, checked.input, this.originKind(i));
            const resources = checked.c.resolve(this.commandContext(i), checked.input);
            this.checkCopilotScope(this.originKind(i), resources, checked.c.id, checked.input, this.commandContext(i), false);
            this.context.externalAuthorize?.(resources);
            if (checkRevision && canonical(resources) !== resourceBaseline) throw new Error('Stale resource revision');
            return resources;
        };
        try {
            const result = await checked.c.execute({ ...this.commandContext(i), actionIntentId: id,
                authorize: () => { authorize(); },
                checkpointResources: () => {
                    // Only trusted command code can checkpoint its own synchronous
                    // mutation. Project/root authority cannot expand mid-action.
                    const before = JSON.parse(resourceBaseline) as CommandResources;
                    const after = authorize(false);
                    if (canonical({ projectIds: before.projectIds, rootPaths: before.rootPaths })
                        !== canonical({ projectIds: after.projectIds, rootPaths: after.rootPaths })) {
                        throw new Error('Action resource scope changed');
                    }
                    resourceBaseline = canonical(after);
                }
            }, checked.input);
            return this.intents.finish(id, 'confirmed', result);
        }
        catch (error) {
            this.context.db.transaction(() => {
                this.intents.finish(id, error instanceof PlatformNoEffectError ? 'no_effect' : 'unknown', { error: error instanceof Error ? error.message : 'External action failed' });
            }).immediate();
            throw error;
        } finally {clearInterval(heartbeat);}
    }
    private claim(i: ActionIntent) {
        const owner=randomUUID();
        if(!this.intents.start(i.id,owner,Date.now()+30_000))throw new Error('Action already executing');
        return owner;
    }
    async executeOwner(commandId: string, input: unknown, idempotencyKey: string) {
        const i = this.preview({ commandId, input, idempotencyKey });
        return (await this.execute(i.id)).result;
    }
}
