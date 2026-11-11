import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { authenticate } from '../auth/middleware.js';
import type { Database } from '../db/types.js';
import { PlatformActions } from '../services/platform-commands/actions.js';
import { createPlatformCommands } from '../services/platform-commands/catalog.js';
import { CopilotMachineRootRepository } from '../db/repositories/copilot-machine-root-repository.js';
import { ok, invalid, notFound, parseId, userId, withBody } from './copilot-helpers.js';

const registerInput = z.object({ label: z.string().trim().min(1).max(200), path: z.string().trim().min(1).max(1024) }).strict();

/**
 * Owner-managed local search roots for the copilot's read-only machine_search /
 * read_machine_file tools. Registering or revoking goes through the platform
 * command (executeOwner) so the same directory guard, root validation and
 * tenant scoping apply as when the agent does it; the console just avoids the
 * agent's approval round-trip.
 */
export function createCopilotMachineRootRoutes(db: Database): Router {
  const router = Router();
  router.use(authenticate);
  const actions = (uid: string) => new PlatformActions({ db, userId: uid }, createPlatformCommands());

  router.get('/machine-roots', (req, res) => {
    const roots = new CopilotMachineRootRepository(db, userId(req)).list().map(({ id, label, path }) => ({ id, label, path }));
    res.json(ok({ roots }));
  });

  router.post('/machine-roots', (req, res) => withBody(req.body, registerInput, res, async (value) => {
    try {
      const root = await actions(userId(req)).executeOwner('machine.register_root', value, randomUUID());
      res.status(201).json(ok({ root }));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'MACHINE_ROOT_ALREADY_REGISTERED')
        return res.status(409).json({ code: 1, message: 'This local path is already registered', details: { code: 'MACHINE_ROOT_EXISTS' } });
      if (message === 'Machine root must be an existing directory')
        return invalid(res, 'Local path is not an existing directory');
      return invalid(res, 'Could not register this local path');
    }
  }));

  router.delete('/machine-roots/:id', async (req, res) => {
    const id = parseId(req.params.id, res);
    if (!id) return;
    try {
      await actions(userId(req)).executeOwner('machine.unregister_root', { rootId: id }, randomUUID());
      res.json(ok({ unregistered: true }));
    } catch {
      notFound(res);
    }
  });

  return router;
}
