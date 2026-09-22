import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthenticatedRequest } from '../auth/middleware.js';
import type { Database } from '../db/types.js';
import { channelPlatforms } from '../services/channels/channel-identity-service.js';
import { runChannelDiagnostics } from '../services/channels/channel-diagnostics.js';

/** Owner diagnostics only; reveals health metadata, never credentials or peer secrets. */
export function createChannelDiagnosticsRoutes(deps: { db: Database; masterKey: string }): Router {
  const router = Router();
  router.use(authenticate);
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/:channel/diagnostics', (req: Request, res: Response): void => {
    const parsed = z.object({ channel: z.enum(channelPlatforms) }).safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ code: 1, message: 'Channel request rejected', details: { code: 'CHANNEL_INPUT_INVALID' } });
      return;
    }
    res.status(200).json({ code: 0, data: runChannelDiagnostics(deps.db, (req as AuthenticatedRequest).userId, deps.masterKey, parsed.data.channel), message: '' });
  });
  return router;
}
