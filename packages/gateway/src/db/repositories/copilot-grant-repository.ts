import { randomUUID } from 'node:crypto';
import type { Database } from '../types.js';
export interface GrantScope {
    projectIds: string[];
    capabilities: string[];
    allowedRoots: string[];
}
export interface CopilotGrant {
    id: string;
    userId: string;
    actorUserId: string;
    name: string;
    status: string;
    revision: number;
    scope: GrantScope;
    expiresAt: number;
    maxActions: number;
    maxConcurrency: number;
    usedActions: number;
    createdAt: number;
}
interface Row {
    id: string;
    user_id: string;
    actor_user_id: string;
    name: string;
    status: string;
    revision: number;
    scope_json: string;
    expires_at: number;
    max_actions: number;
    max_concurrency: number;
    used_actions: number;
    created_at: number;
}
function map(r: Row): CopilotGrant {
    return { id: r.id, userId: r.user_id, actorUserId: r.actor_user_id, name: r.name, status: r.status, revision: r.revision, scope: JSON.parse(r.scope_json), expiresAt: r.expires_at, maxActions: r.max_actions, maxConcurrency: r.max_concurrency, usedActions: r.used_actions, createdAt: r.created_at };
}
export class CopilotGrantRepository {
    constructor(private db: Database, private userId: string) {
    }
    get(id: string) {
        const row = this.db.prepare('SELECT * FROM copilot_grants WHERE user_id=? AND id=?').get(this.userId, id) as Row | undefined;
        return row ? map(row) : undefined;
    }
    list() {
        return (this.db.prepare('SELECT * FROM copilot_grants WHERE user_id=? ORDER BY created_at DESC').all(this.userId) as Row[]).map(map);
    }
    create(input: {
        name: string;
        scope: GrantScope;
        expiresAt: number;
        maxActions: number;
        maxConcurrency: number;
    }) {
        const id = randomUUID();
        this.db.prepare(`INSERT INTO copilot_grants(id,user_id,actor_user_id,name,scope_json,expires_at,max_actions,max_concurrency,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(id, this.userId, this.userId, input.name, JSON.stringify(input.scope), input.expiresAt, input.maxActions, input.maxConcurrency, Date.now());
        return this.get(id)!;
    }
    revoke(id: string) {
        this.db.prepare("UPDATE copilot_grants SET status='revoked',revision=revision+1 WHERE user_id=? AND id=? AND status='active'").run(this.userId, id);
        return this.get(id);
    }
    consume(id: string, revision: number) {
        return this.db.prepare("UPDATE copilot_grants SET used_actions=used_actions+1 WHERE user_id=? AND id=? AND revision=? AND status='active' AND expires_at>? AND used_actions<max_actions").run(this.userId, id, revision, Date.now()).changes === 1;
    }
    refund(id: string) {
        this.db.prepare("UPDATE copilot_grants SET used_actions=MAX(0,used_actions-1) WHERE user_id=? AND id=?").run(this.userId, id);
    }
    binding(conversationId: string) {
        return (this.db.prepare('SELECT grant_id FROM copilot_conversation_grants WHERE user_id=? AND conversation_id=?').get(this.userId, conversationId) as {
            grant_id: string;
        } | undefined)?.grant_id;
    }
    bind(conversationId: string, grantId: string) {
        this.db.prepare('INSERT INTO copilot_conversation_grants(conversation_id,user_id,grant_id,created_at) VALUES (?,?,?,?)').run(conversationId, this.userId, grantId, Date.now());
    }
}
