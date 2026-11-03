import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthenticatedRequest } from '../auth/middleware.js';
import type { Database } from '../db/types.js';
import { CompanionError, CompanionService } from '../services/companion/companion-service.js';

export function createCompanionRoutes(deps: {
  db: Database;
  masterKey: string;
  companionEnabled?: boolean | undefined;
}): Router {
  const router = Router();
  router.use(authenticate);
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  const service = () => new CompanionService(deps.db, deps.masterKey, deps.companionEnabled === true);
  const actor = (req: Request) => (req as AuthenticatedRequest).userId;
  const handler = (run: (req: Request) => unknown, created = false) => (req: Request, res: Response): void => {
    try {
      res.status(created ? 201 : 200).json({ code: 0, data: run(req), message: '' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ code: 1, message: 'Companion request rejected', details: { code: 'COMPANION_INPUT_INVALID' } });
        return;
      }
      if (error instanceof CompanionError) {
        res.status(error.status).json({ code: 1, message: 'Companion request rejected', details: { code: error.code } });
        return;
      }
      res.status(500).json({ code: 1, message: 'Companion request rejected', details: { code: 'COMPANION_INTERNAL_ERROR' } });
    }
  };

  router.get('/host', handler(() => service().getHostStatus()));
  router.put('/host', handler(req => service().configureHost(actor(req), req.body)));
  router.get('/pairings', handler(req => ({ pairings: service().listPairings(actor(req)) })));
  router.post('/pairings', handler(req => service().createPairing(actor(req), req.body), true));
  router.post('/pairings/:id/confirm', handler(req => service().confirmPairing(actor(req), req.params.id!, req.body)));
  router.post('/pairings/:id/cancel', handler(req => {
    service().cancelPairing(actor(req), req.params.id!);
    return { cancelled: true };
  }));
  router.get('/devices', handler(req => ({ devices: service().listDevices(actor(req)) })));
  router.patch('/devices/:id', handler(req => service().updateDevice(actor(req), req.params.id!, req.body)));
  router.post('/devices/:id/revoke', handler(req => {
    service().revokeDevice(actor(req), req.params.id!);
    return { revoked: true };
  }));
  return router;
}
