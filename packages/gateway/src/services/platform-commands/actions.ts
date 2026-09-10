import { PlatformNoEffectError } from "./errors.js";
import { TOOL_COMMANDS } from "./tool-commands.js";
import { CopilotToolPreferenceRepository } from "../../db/repositories/copilot-tool-preference-repository.js";
import { createSecurityPolicy } from "../agent/security-policy.js";
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { PlatformActionRepository, type ActionIntent } from '../../db/repositories/platform-action-repository.js';
import { CopilotGrantRepository, type CopilotGrant } from '../../db/repositories/copilot-grant-repository.js';
import { ProjectRepository } from '../../db/repositories/project-repository.js';
import { validateProjectRoot, DENIED_ROOTS } from '../../lib/safe-resolve.js';
import type { CommandContext, PlatformCommand, CommandResources } from './types.js';
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
const previewSchema = z.object({ commandId: z.string().min(1).max(100), input: z.unknown(), idempotencyKey: z.string().min(1).max(200), authority: z.enum(['owner_action', 'delegated_grant']), grantId: z.string().min(1).optional() }).strict();
export const createGrantSchema = z.object({ name: z.string().trim().min(1).max(200), projectIds: z.array(z.string().min(1)).max(100), capabilities: z.array(z.string().min(1)).min(1).max(50), allowedRoots: z.array(z.string().min(1)).max(20).default([]), expiresAt: z.number().int().positive(), maxActions: z.number().int().min(1).max(10000), maxConcurrency: z.number().int().min(1).max(20).default(1) }).strict();
export class PlatformActions {
    readonly intents: PlatformActionRepository;
    readonly grants: CopilotGrantRepository;
    constructor(readonly context: CommandContext, readonly commands: Map<string, PlatformCommand>) {
        this.intents = new PlatformActionRepository(context.db, context.userId);
        this.grants = new CopilotGrantRepository(context.db, context.userId);
        this.intents.recoverExpired();
    }
    private activeActor() {
        const user = this.context.db.prepare('SELECT status FROM users WHERE id=?').get(this.context.userId) as {
            status: string;
        } | undefined;
        if (user?.status !== 'active')
            throw new Error('Actor is not active');
    }
    createGrant(raw: unknown) {
        this.activeActor();
        const v = createGrantSchema.parse(raw);
        if (v.expiresAt <= Date.now())
            throw new Error('Grant expiry must be in the future');
        for (const id of v.projectIds)
            if (!new ProjectRepository(this.context.db, this.context.userId).getById(id))
                throw new Error('Grant project not found');
        for (const cap of v.capabilities)
            if (![...this.commands.values()].some(c => c.capability === cap && c.delegatable))
                throw new Error('Unsupported grant capability');
        return this.grants.create({ name: v.name, scope: { projectIds: [...new Set(v.projectIds)], capabilities: [...new Set(v.capabilities)], allowedRoots: [...new Set(v.allowedRoots.map(canonicalRoot))] }, expiresAt: v.expiresAt, maxActions: v.maxActions, maxConcurrency: v.maxConcurrency });
    }
    assertGrant(id: string) {
        this.activeActor();
        const g = this.grants.get(id);
        if (!g || g.status !== 'active' || g.expiresAt <= Date.now() || g.actorUserId !== this.context.userId)
            throw new Error('Grant unavailable, expired or revoked');
        return g;
    }
    private checkScope(g: CopilotGrant, c: PlatformCommand, r: CommandResources) {
        if (!c.delegatable || !g.scope.capabilities.includes(c.capability))
            throw new Error('Action outside grant capability');
        if (r.projectIds.some(id => !g.scope.projectIds.includes(id)))
            throw new Error('Action outside grant project scope');
        for (const root of r.rootPaths ?? []) {
            const actual = canonicalRoot(root);
            if (!g.scope.allowedRoots.some(base => {
                const rel = path.relative(canonicalRoot(base), actual);
                return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
            }))
                throw new Error('Action outside grant root scope');
        }
        if (g.usedActions >= g.maxActions)
            throw new Error('Grant action budget exhausted');
        if (this.intents.activeForGrant(g.id) >= g.maxConcurrency)
            throw new Error('Grant concurrency exhausted');
    }
    private checkMemoryScope(g: CopilotGrant, c: PlatformCommand, input: unknown) {
        if (c.id !== 'memory.write')
            return;
        const v = input as {
            scope: string;
            conversationId?: string;
        };
        if (v.scope === 'global')
            throw new Error('Global memory outside project grant');
        if (v.scope === 'session' && (!v.conversationId || this.grants.binding(v.conversationId) !== g.id))
            throw new Error('Conversation outside grant scope');
    }
    private checkPolicy(c: PlatformCommand, input: unknown) {
        const prefs = new CopilotToolPreferenceRepository(this.context.db, this.context.userId);
        if (Object.entries(TOOL_COMMANDS).some(([tool, command]) => command === c.id && !prefs.isEnabled(tool)))
            throw new Error("Tool disabled by owner");
        const toolName = Object.entries(TOOL_COMMANDS).find(([, id]) => id === c.id)?.[0] ?? c.id;
        const decision = createSecurityPolicy().evaluate({ userId: this.context.userId, toolName, toolRisk: "operate", requiresApproval: true, input });
        if (decision.action === "deny")
            throw new Error(`Denied by security policy: ${decision.reason}`);
    }
    preview(raw: unknown): ActionIntent {
        this.activeActor();
        const v = previewSchema.parse(raw);
        const c = this.commands.get(v.commandId);
        if (!c)
            throw new Error('Unknown platform command');
        const input = c.inputSchema.parse(v.input);
        this.checkPolicy(c, input);
        const previous = this.intents.byKey(v.idempotencyKey);
        if (previous) {
            if (previous.command_id !== c.id || previous.input_json !== canonical(input) || previous.authority !== v.authority || previous.grant_id !== (v.grantId ?? null))
                throw new Error('Idempotency key conflicts with payload or authority');
            return previous;
        }
        const resources = c.resolve(this.context, input);
        const g = v.authority === 'delegated_grant' ? this.assertGrant(v.grantId ?? '') : undefined;
        if (v.authority === 'owner_action' && v.grantId)
            throw new Error('Grant authority cannot fall back to owner');
        if (g) {
            this.checkScope(g, c, resources);
            this.checkMemoryScope(g, c, input);
        }
        const digest = createHash('sha256').update(canonical({ commandId: c.id, input, resources, authority: v.authority, grantId: g?.id, grantRevision: g?.revision, policyVersion: 1 })).digest('hex');
        return this.intents.create({ actor_user_id: this.context.userId, grant_id: g?.id ?? null, grant_revision: g?.revision ?? null, authority: v.authority, command_id: c.id, input_json: canonical(input), digest, resources_json: canonical(resources), policy_version: 1, expires_at: Math.min(Date.now() + 15 * 60000, g?.expiresAt ?? Infinity), idempotency_key: v.idempotencyKey, status: g ? 'approved' : 'pending' });
    }
    decide(id: string, digest: string, approve: boolean) {
        this.activeActor();
        const i = this.intents.get(id);
        if (!i)
            throw new Error('Action not found');
        if (i.digest !== digest || i.expires_at <= Date.now())
            throw new Error('Stale action approval');
        if (i.authority !== 'owner_action')
            throw new Error('Grant actions cannot be promoted to owner authority');
        if (approve)
            this.check({ ...i, status: 'approved' });
        if (!this.intents.transition(id, 'pending', approve ? 'approved' : 'rejected'))
            throw new Error('Action already decided');
        return this.intents.get(id)!;
    }
    private check(i: ActionIntent) {
        this.activeActor();
        this.intents.assertOriginActive(i.idempotency_key);
        if (i.status !== 'approved' || i.expires_at <= Date.now() || i.policy_version !== 1)
            throw new Error('Action is not approved or has expired');
        const c = this.commands.get(i.command_id);
        if (!c)
            throw new Error('Command unavailable');
        const input = c.inputSchema.parse(JSON.parse(i.input_json));
        this.checkPolicy(c, input);
        const resources = c.resolve(this.context, input);
        if (canonical(resources) !== i.resources_json)
            throw new Error('Stale resource revision');
        if (i.grant_id) {
            const g = this.assertGrant(i.grant_id);
            if (g.revision !== i.grant_revision)
                throw new Error('Stale grant revision');
            this.checkScope(g, c, resources);
            this.checkMemoryScope(g, c, input);
        }
        return { c, input };
    }
    async execute(id: string) {
        const old = this.intents.receipt(id);
        if (old)
            return old;
        const i = this.intents.get(id);
        if (!i)
            throw new Error('Action not found');
        if (i.status === 'executing' || i.status === 'indeterminate')
            throw new Error('Action effect indeterminate; automatic replay prohibited');
        const { c, input } = this.check(i);
        if (c.prepare)
            await c.prepare(this.context, input);
        const preparedReceipt = this.intents.receipt(id);
        if(preparedReceipt) return preparedReceipt;
        if (c.effect === 'database') {
            try {
                return this.context.db.transaction(() => {
                    const fresh = this.intents.get(id)!;
                    const checked = this.check(fresh);
                    this.claim(fresh);
                    const result = checked.c.execute(this.context, checked.input);
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
        try {
            const result = await checked.c.execute({ ...this.context, authorize: () => {
                    this.activeActor();
                    this.intents.assertOriginActive(i.idempotency_key);
                    if (i.expires_at <= Date.now())
                        throw new Error("Action expired");
                    this.intents.assertExecutionOwner(id,checked.owner);
                    this.checkPolicy(checked.c, checked.input);
                    if (canonical(checked.c.resolve(this.context, checked.input)) !== i.resources_json)
                        throw new Error("Stale resource revision");
                    if (i.grant_id) {
                        const grant = this.assertGrant(i.grant_id);
                        if (grant.revision !== i.grant_revision)
                            throw new Error("Grant revision changed");
                    }
                } }, checked.input);
            return this.intents.finish(id, 'confirmed', result);
        }
        catch (error) {
            this.context.db.transaction(() => {
                if (error instanceof PlatformNoEffectError && i.grant_id)
                    this.grants.refund(i.grant_id);
                this.intents.finish(id, error instanceof PlatformNoEffectError ? 'no_effect' : 'unknown', { error: error instanceof Error ? error.message : 'External action failed' });
            }).immediate();
            throw error;
        } finally {clearInterval(heartbeat);}
    }
    private claim(i: ActionIntent) {
        if(i.grant_id&&!this.grants.consume(i.grant_id,i.grant_revision!))throw new Error('Grant budget changed');
        const owner=randomUUID();
        if(!this.intents.start(i.id,owner,Date.now()+30_000))throw new Error('Action already executing');
        return owner;
    }
    async executeOwner(commandId: string, input: unknown, idempotencyKey: string) {
        const i = this.preview({ commandId, input, idempotencyKey, authority: 'owner_action' });
        if (i.status === 'pending')
            this.decide(i.id, i.digest, true);
        return (await this.execute(i.id)).result;
    }
}
