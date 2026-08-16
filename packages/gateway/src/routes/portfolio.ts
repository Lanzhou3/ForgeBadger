import { Router, type Response } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import type { PortfolioApiFacade } from "../services/portfolio/portfolio-api-service.js";

const idSchema = z.string().trim().min(1).max(128);
const idempotencyKeySchema = z.string().trim().min(8).max(256);
const recordSchema = z.record(z.unknown());
const workItemSchema = z.object({
  title: z.string().trim().min(1).max(512),
  description: z.string().trim().max(16_384).optional(),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(2_048)).max(100).optional(),
  verificationRequirements: z.array(z.string().trim().min(1).max(2_048)).max(100).optional()
}).strict();
const querySchema = z.object({ projectId: idSchema.optional(), limit: z.coerce.number().int().min(1).max(200).optional() }).strict();
const stateSchema = z.object({
  toState: z.string().trim().min(1).max(64),
  expectedProjectionVersion: z.number().int().min(1),
  attemptId: idSchema.optional(),
  correlationId: z.string().trim().min(1).max(256).optional()
}).strict();

/** HTTP adapter only: all Portfolio mutations are delegated to the restricted facade. */
export function createPortfolioRoutes(api: PortfolioApiFacade): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/overview", (req, res) => withQuery(req.query, querySchema, res, (value) => {
    res.json(ok(api.forUser(userId(req)).getOverview(value as never)));
  }));

  router.get("/dossiers/:projectId", (req, res) => {
    const projectId = parseId(req.params.projectId, res); if (!projectId) return;
    const dossier = api.forUser(userId(req)).getDossier(projectId);
    if (!dossier) return notFound(res);
    res.json(ok({ dossier }));
  });
  router.post("/dossiers/:projectId/enroll", (req, res) => withBody(req.body, enrollSchema, res, (value) => withKey(req, res, (idempotencyKey) => {
    const projectId = parseId(req.params.projectId, res); if (!projectId) return;
    respondMutation(res, () => api.forUser(userId(req)).enrollProject({ ...value, projectId, idempotencyKey } as never), 201);
  })));
  router.patch("/dossiers/:projectId", (req, res) => withBody(req.body, dossierUpdateSchema, res, (value) => withKey(req, res, (idempotencyKey) => {
    const projectId = parseId(req.params.projectId, res); if (!projectId) return;
    respondMutation(res, () => api.forUser(userId(req)).updateDossier({ ...value, projectId, idempotencyKey } as never));
  })));

  router.get("/requests", (req, res) => withQuery(req.query, querySchema, res, (value) => {
    res.json(ok({ requests: api.forUser(userId(req)).listRequests(value as never) }));
  }));
  router.post("/requests", (req, res) => withBody(req.body, requestSchema, res, (value) => withKey(req, res, (idempotencyKey) => {
    respondMutation(res, () => api.forUser(userId(req)).createRequest({ ...value, idempotencyKey } as never), 201);
  })));
  router.get("/requests/:requestId/timeline", (req, res) => {
    const requestId = parseId(req.params.requestId, res); if (!requestId) return;
    respondRead(res, () => api.forUser(userId(req)).getRequestTimeline(requestId));
  });
  router.post("/requests/:requestId/intake-decisions", (req, res) => withBody(req.body, intakeSchema, res, (value) => withKey(req, res, (idempotencyKey) => {
    const requestId = parseId(req.params.requestId, res); if (!requestId) return;
    respondMutation(res, () => api.forUser(userId(req)).decideIntake({ ...value, requestId, idempotencyKey } as never));
  })));
  router.post("/requests/:requestId/owner-decision", (req, res) => withBody(req.body, ownerDecisionSchema, res, (value) => withKey(req, res, (idempotencyKey) => {
    const requestId = parseId(req.params.requestId, res); if (!requestId) return;
    respondMutation(res, () => api.forUser(userId(req)).resolveOwnerDecision({ ...value, requestId, idempotencyKey } as never));
  })));

  router.get("/work-items/:workItemId", (req, res) => {
    const workItemId = parseId(req.params.workItemId, res); if (!workItemId) return;
    const workItem = api.forUser(userId(req)).getWorkItem(workItemId);
    if (!workItem) return notFound(res);
    res.json(ok({ workItem }));
  });
  router.post("/work-items/:workItemId/attempts", (req, res) => withBody(req.body, attemptSchema, res, (value) => withKey(req, res, (idempotencyKey) => {
    const workItemId = parseId(req.params.workItemId, res); if (!workItemId) return;
    respondMutation(res, () => api.forUser(userId(req)).prepareAttempt({ ...value, workItemId, idempotencyKey } as never), 201);
  })));
  router.post("/work-items/:workItemId/state", (req, res) => withBody(req.body, stateSchema, res, (value) => withKey(req, res, (idempotencyKey) => {
    const workItemId = parseId(req.params.workItemId, res); if (!workItemId) return;
    respondMutation(res, () => api.forUser(userId(req)).transition({ ...value, recordType: "work_item", recordId: workItemId, idempotencyKey } as never));
  })));

  router.get("/attempts/:attemptId", (req, res) => {
    const attemptId = parseId(req.params.attemptId, res); if (!attemptId) return;
    const attempt = api.forUser(userId(req)).getAttempt(attemptId);
    if (!attempt) return notFound(res);
    res.json(ok({ attempt }));
  });
  router.get("/authorizations/:authorizationId", (req, res) => {
    const authorizationId = parseId(req.params.authorizationId, res); if (!authorizationId) return;
    const authorization = api.forUser(userId(req)).getAuthorization(authorizationId);
    if (!authorization) return notFound(res);
    res.json(ok({ authorization }));
  });
  router.post("/authorizations/:authorizationId/state", (req, res) => withBody(req.body, stateSchema, res, (value) => withKey(req, res, (idempotencyKey) => {
    const authorizationId = parseId(req.params.authorizationId, res); if (!authorizationId) return;
    respondMutation(res, () => api.forUser(userId(req)).transition({ ...value, recordType: "authorization", recordId: authorizationId, idempotencyKey } as never));
  })));

  router.get("/observations/:projectId", (req, res) => {
    const projectId = parseId(req.params.projectId, res); if (!projectId) return;
    const observation = api.forUser(userId(req)).getObservation(projectId);
    if (!observation) return notFound(res);
    res.json(ok({ observation }));
  });
  router.get("/risks/:riskId", (req, res) => readById(req.params.riskId, res, (riskId) => api.forUser(userId(req)).getRisk(riskId), "risk"));
  router.get("/wakeups/:wakeupId", (req, res) => readById(req.params.wakeupId, res, (wakeupId) => api.forUser(userId(req)).getWakeup(wakeupId), "wakeup"));
  router.get("/heartbeat", (req, res) => res.json(ok({ heartbeat: api.forUser(userId(req)).getHeartbeat() ?? { enabled: false, cadenceMinutes: null, projectionVersion: 0 } })));
  router.put("/heartbeat", (req, res) => withBody(req.body, heartbeatSchema, res, (value) => withKey(req, res, (idempotencyKey) => {
    respondMutation(res, () => api.forUser(userId(req)).setHeartbeat({ ...value, idempotencyKey } as never));
  })));
  router.post("/channels/feishu/bindings", (req, res) => withBody(req.body, feishuBindingSchema, res, (value) => withKey(req, res, (idempotencyKey) => {
    respondMutation(res, () => api.forUser(userId(req)).provisionFeishuBinding({ ...value, idempotencyKey } as never), 201);
  })));

  return router;
}

const enrollSchema = z.object({
  objective: z.string().trim().min(1).max(4_096), intendedOutcome: z.string().trim().min(1).max(4_096),
  scope: recordSchema.optional(), observedState: recordSchema, evidenceIds: z.array(idSchema).min(1).max(100),
  initialEvidence: z.array(z.object({ id: idSchema, producer: z.string().trim().min(1).max(128), sourceCategory: z.string().trim().min(1).max(128), observedAt: z.coerce.date(), digest: z.string().trim().min(1).max(256), summary: z.string().trim().min(1).max(1_024), confidence: z.string().trim().min(1).max(64), freshness: z.string().trim().min(1).max(64) }).strict()).min(1).max(100)
}).strict();
const dossierUpdateSchema = z.object({ expectedProjectionVersion: z.number().int().min(1), objective: z.string().trim().min(1).max(4_096).optional(), intendedOutcome: z.string().trim().min(1).max(4_096).optional(), scope: recordSchema.optional(), observedState: recordSchema.optional(), evidenceIds: z.array(idSchema).min(1).max(100).optional() }).strict();
const requestSchema = z.object({ projectId: idSchema.optional(), source: z.literal("web"), requestText: z.string().trim().min(1).max(32_768), correlationId: z.string().trim().min(1).max(256), sourceMetadata: recordSchema.optional() }).strict();
const intakeSchema = z.object({ candidateProjectIds: z.array(idSchema).max(100), selectedProjectId: idSchema.optional(), scopeAssessment: z.enum(["in_boundary", "ambiguous", "multi_project", "missing_dossier", "scope_change", "material_scope_change", "owner_confirmed"]), producer: z.string().trim().min(1).max(128), evidenceIds: z.array(idSchema).max(100).optional(), workItem: workItemSchema.optional() }).strict();
const ownerDecisionSchema = z.object({ projectId: idSchema, evidenceIds: z.array(idSchema).max(100).optional(), workItem: workItemSchema.optional() }).strict();
const attemptSchema = z.object({ projectId: idSchema, adapter: z.enum(["claude", "opencode", "codex", "kimi"]), skillVersion: z.literal("portfolio-execution/v1"), toolIds: z.array(z.literal("portfolio.submit_canonical_task_packet")).min(1).max(1), trackingEnabled: z.boolean().optional() }).strict();
const heartbeatSchema = z.object({ enabled: z.boolean(), cadenceMinutes: z.number().int().min(5).max(1_440).optional() }).strict();
const feishuBindingSchema = z.object({
  providerAccountId: idSchema,
  externalIdentity: z.string().trim().min(1).max(512),
  conversationId: z.string().trim().min(1).max(512),
  isOwner: z.boolean(),
  projectId: idSchema.optional()
}).strict();

function userId(req: unknown): string { return (req as AuthenticatedRequest).userId; }
function ok(data: unknown) { return { code: 0, data, message: "" }; }
function parseId(value: string | undefined, res: Response): string | undefined { const parsed = idSchema.safeParse(value); if (!parsed.success) invalid(res); return parsed.success ? parsed.data : undefined; }
function withKey(req: { header(name: string): string | undefined }, res: Response, callback: (key: string) => void): void { const parsed = idempotencyKeySchema.safeParse(req.header("idempotency-key")); if (!parsed.success) return invalid(res, "Idempotency-Key is required"); callback(parsed.data); }
function withBody<T>(body: unknown, schema: z.ZodType<T>, res: Response, callback: (value: T) => void): void { const parsed = schema.safeParse(body); if (!parsed.success) return invalid(res); callback(parsed.data); }
function withQuery<T>(query: unknown, schema: z.ZodType<T>, res: Response, callback: (value: T) => void): void { const parsed = schema.safeParse(query); if (!parsed.success) return invalid(res); callback(parsed.data); }
function respondMutation(res: Response, operation: () => unknown, status = 200): void { try { res.status(status).json(ok(operation())); } catch (error) { domainError(res, error); } }
function respondRead(res: Response, operation: () => unknown): void { try { const data = operation(); if (!data) return notFound(res); res.json(ok(data)); } catch (error) { domainError(res, error); } }
function readById(value: string | undefined, res: Response, operation: (id: string) => unknown, name: string): void { const id = parseId(value, res); if (!id) return; const data = operation(id); if (!data) return notFound(res); res.json(ok({ [name]: data })); }
function invalid(res: Response, message = "Invalid input"): void { res.status(400).json({ code: 1, message, details: { code: "PORTFOLIO_INVALID_INPUT" } }); }
function notFound(res: Response): void { res.status(404).json({ code: 1, message: "Portfolio record not found", details: { code: "PORTFOLIO_NOT_FOUND" } }); }
function domainError(res: Response, error: unknown): void { const code = error instanceof Error ? error.message : "PORTFOLIO_OPERATION_FAILED"; const hidden = /PORTFOLIO_FEISHU_(ACCOUNT|BINDING)|NOT_FOUND|SCOPE_MISMATCH/.test(code); const status = hidden ? 404 : /CONFLICT|INVALID_TRANSITION|PRECONDITION|OWNER_REQUIRED|LEASE_MISMATCH/.test(code) ? 409 : 400; res.status(status).json({ code: 1, message: status === 404 ? "Portfolio record not found" : "Portfolio operation rejected", details: { code: hidden ? "PORTFOLIO_NOT_FOUND" : code } }); }
