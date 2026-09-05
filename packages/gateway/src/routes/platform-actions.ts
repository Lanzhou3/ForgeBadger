import { Router } from 'express';
import { z } from 'zod';
import { authenticate, type AuthenticatedRequest } from '../auth/middleware.js';
import { PlatformActions } from '../services/platform-commands/actions.js';
import { createPlatformCommands } from '../services/platform-commands/catalog.js';
import { CopilotRunLedger } from '../services/agent/run-ledger.js';
import type { CommandContext } from '../services/platform-commands/types.js';
const preview = z.object({ commandId: z.string().min(1), input: z.unknown(), idempotencyKey: z.string().min(1), grantId: z.string().optional() }).strict();
const decide = z.object({ digest: z.string().length(64), approved: z.boolean() }).strict();
export function createPlatformActionRoutes(deps: Omit<CommandContext, 'userId'>): Router {
    const router = Router();
    router.use(authenticate);
    const service = (req: unknown) => new PlatformActions({ ...deps, userId: (req as AuthenticatedRequest).userId }, createPlatformCommands());
    const handler = (fn: (req: import('express').Request) => unknown) => async (req: import('express').Request, res: import('express').Response) => {
        try {
            res.json({ code: 0, data: await fn(req), message: '' });
        }
        catch (error) {
            res.status(error instanceof z.ZodError ? 400 : 409).json({ code: 1, message: error instanceof Error ? error.message : 'Platform action failed', details: { code: 'PLATFORM_ACTION_REJECTED' } });
        }
    };
    router.get('/copilot/grants', handler(req => ({ grants: service(req).grants.list(), capabilities: [...createPlatformCommands().values()].filter(c => c.delegatable).map(c => ({ id: c.id, capability: c.capability, effect: c.effect })) })));
    router.post('/copilot/grants', handler(req => ({ grant: service(req).createGrant(req.body) })));
    router.post('/copilot/grants/:id/revoke', handler(req => {
        const s = service(req);
        return deps.db.transaction(() => {
            const grant = s.grants.revoke(z.string().min(1).max(128).parse(req.params.id));
            if (!grant)
                throw new Error('Grant not found');
            const ledger = new CopilotRunLedger(deps.db, s.context.userId);
            const runs = deps.db.prepare("SELECT id,input_json FROM copilot_runs WHERE user_id=? AND status IN ('pending','running','awaiting_approval')").all(s.context.userId) as {
                id: string;
                input_json: string;
            }[];
            for (const run of runs)
                if ((JSON.parse(run.input_json) as {
                    grantId?: string;
                }).grantId === grant.id)
                    ledger.cancel(run.id);
            return { grant };
        }).immediate();
    }));
    router.post('/platform-actions/preview', handler(req => {
        const v = preview.parse(req.body);
        return { intent: service(req).preview({ ...v, authority: v.grantId ? 'delegated_grant' : 'owner_action' }) };
    }));
    router.get('/platform-actions/:id', handler(req => {
        const s = service(req);
        const intent = s.intents.get(z.string().min(1).max(128).parse(req.params.id));
        if (!intent)
            throw new Error('Action not found');
        return { intent, receipt: s.intents.receipt(intent.id) ?? null };
    }));
    router.post('/platform-actions/:id/decide', handler(req => {
        const v = decide.parse(req.body);
        return { intent: service(req).decide(z.string().min(1).max(128).parse(req.params.id), v.digest, v.approved) };
    }));
    router.post('/platform-actions/:id/execute', handler(async (req) => ({ receipt: await service(req).execute(z.string().min(1).max(128).parse(req.params.id)) })));
    return router;
}
