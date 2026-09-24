import { Router } from 'express';
import { z } from 'zod';
import { authenticate, type AuthenticatedRequest } from '../auth/middleware.js';
import { PlatformActions } from '../services/platform-commands/actions.js';
import { createPlatformCommands } from '../services/platform-commands/catalog.js';
import type { CommandContext } from '../services/platform-commands/types.js';
const preview = z.object({ commandId: z.string().min(1), input: z.unknown(), idempotencyKey: z.string().min(1) }).strict();
export function createPlatformActionRoutes(deps: Omit<CommandContext, 'userId'>): Router {
    const router = Router();
    router.use(authenticate);
    const service = (req: unknown) => new PlatformActions({ ...deps, actionOrigin:{kind:'owner_api'}, userId: (req as AuthenticatedRequest).userId }, createPlatformCommands());
    const handler = (fn: (req: import('express').Request) => unknown) => async (req: import('express').Request, res: import('express').Response) => {
        try {
            res.json({ code: 0, data: await fn(req), message: '' });
        }
        catch (error) {
            res.status(error instanceof z.ZodError ? 400 : 409).json({ code: 1, message: error instanceof Error ? error.message : 'Platform action failed', details: { code: 'PLATFORM_ACTION_REJECTED' } });
        }
    };
    router.post('/platform-actions/preview', handler(req => {
        const v = preview.parse(req.body);
        return { intent: service(req).preview(v) };
    }));
    router.get('/platform-actions/:id', handler(req => {
        const s = service(req);
        const intent = s.intents.get(z.string().min(1).max(128).parse(req.params.id));
        if (!intent)
            throw new Error('Action not found');
        return { intent, receipt: s.intents.receipt(intent.id) ?? null };
    }));
    router.post('/platform-actions/:id/execute', handler(async (req) => ({ receipt: await service(req).execute(z.string().min(1).max(128).parse(req.params.id)) })));
    return router;
}
