import { ChannelDeliveryRepository } from '../db/repositories/channel-delivery-repository.js';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthenticatedRequest } from '../auth/middleware.js';
import type { Database } from '../db/types.js';
import { ChannelIdentityError, ChannelIdentityService } from '../services/channels/channel-identity-service.js';

/** Owner administration only. Trusted transport claim/admission are deliberately not HTTP endpoints. */
export function createCopilotChannelRoutes(deps: { db: Database; masterKey: string }): Router {
  const router = Router();
  router.use(authenticate);
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  const service = (req: Request) => new ChannelIdentityService(deps.db, (req as AuthenticatedRequest).userId, deps.masterKey);
  const handler = (run: (req: Request) => unknown, created = false) => (req: Request, res: Response): void => {
    try { res.status(created ? 201 : 200).json({ code: 0, data: run(req), message: '' }); }
    catch (error) {
      const status = error instanceof z.ZodError ? 400 : error instanceof ChannelIdentityError ? 403 : 409;
      res.status(status).json({ code: 1, message: 'Channel request rejected', details: { code: status === 400 ? 'CHANNEL_INPUT_INVALID' : 'CHANNEL_AUTHORITY_REJECTED' } });
    }
  };
  router.get('/deliveries', handler(req => ({ deliveries: new ChannelDeliveryRepository(deps.db,(req as AuthenticatedRequest).userId).listMetadata() })));
  router.get('/pairings', handler(req => ({ pairings: service(req).records.listPairings() })));
  router.post('/pairings', handler(req => service(req).createPairing(req.body), true));
  router.post('/pairings/:id/confirm', handler(req => ({ identity: service(req).confirmPairing(req.params.id!, req.body) })));
  router.post('/pairings/:id/cancel', handler(req => { service(req).cancelPairing(req.params.id!); return { cancelled: true }; }));
  router.get('/identities', handler(req => ({ identities: service(req).records.listIdentities() })));
  router.post('/identities/:id/revoke', handler(req => { service(req).revokeIdentity(req.params.id!); return { revoked: true }; }));
  router.get('/routes', handler(req => ({ routes: service(req).records.listRoutes() })));
  router.post('/routes', handler(req => ({ route: service(req).createRoute(req.body) }), true));
  router.post('/routes/:id/revoke', handler(req => { service(req).revokeRoute(req.params.id!); return { revoked: true }; }));
  return router;
}
