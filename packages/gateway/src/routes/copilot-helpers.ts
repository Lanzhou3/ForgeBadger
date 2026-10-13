/**
 * Shared helpers for the /api/v1/copilot route family (envelope shape, zod
 * body/query guards, domain-error mapping). Extracted from copilot.ts so new
 * copilot sub-routers (goals, ...) reuse one copy.
 */
import { z } from "zod";
import type { Response } from "express";

import type { AuthenticatedRequest } from "../auth/middleware.js";
import { AgentError } from "../services/agent/types.js";

export const idSchema = z.string().trim().min(1).max(128);

export function userId(req: unknown): string { return (req as AuthenticatedRequest).userId; }
export function ok(data: unknown) { return { code: 0, data, message: "" }; }
export function parseId(value: string | undefined, res: Response): string | undefined {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) invalid(res);
  return parsed.success ? parsed.data : undefined;
}
export function withBody<T>(body: unknown, schema: z.ZodType<T>, res: Response, callback: (value: T) => void): void {
  const parsed = schema.safeParse(body);
  if (!parsed.success) return invalid(res);
  try { Promise.resolve(callback(parsed.data)).catch(error=>domainError(res,error)); }
  catch(error) { domainError(res,error); }
}
export function withQuery<T>(query: unknown, schema: z.ZodType<T>, res: Response, callback: (value: T) => void): void {
  const parsed = schema.safeParse(query);
  if (!parsed.success) return invalid(res);
  try { Promise.resolve(callback(parsed.data)).catch(error=>domainError(res,error)); }
  catch(error) { domainError(res,error); }
}
export function invalid(res: Response, message = "Invalid input"): void {
  res.status(400).json({ code: 1, message, details: { code: "COPILOT_INVALID_INPUT" } });
}
export function notFound(res: Response): void {
  res.status(404).json({ code: 1, message: "Copilot record not found", details: { code: "COPILOT_NOT_FOUND" } });
}
export function domainError(res: Response, error: unknown): void {
  if (error instanceof AgentError && error.code === "AGENT_MEMORY_INDEX_BUILDING") {
    res.setHeader("Retry-After", "5");
    res.status(503).json({ code: 1, message: error.message, details: { code: error.code } });
    return;
  }
  if (error instanceof AgentError && error.code === "AGENT_MEMORY_QUERY_TOO_LONG") {
    res.status(400).json({ code: 1, message: error.message, details: { code: error.code } });
    return;
  }
  if (error instanceof AgentError && ["COPILOT_RUN_BUSY","COPILOT_CONVERSATION_BUSY","COPILOT_REQUEST_CONFLICT","COPILOT_GOAL_STATE","COPILOT_GOAL_SANDBOX_MISSING","COPILOT_GOAL_MERGE_CONFLICT"].includes(error.code)) {
    res.status(409).json({ code: 1, message: error.message, details: { code: error.code } });
    return;
  }
  if(error instanceof AgentError && error.code === "COPILOT_NOT_FOUND")return notFound(res);
  // Goal-series errors surface their own message; everything else keeps the
  // fixed generic text so arbitrary provider/SQL text never leaks.
  if (error instanceof AgentError && error.code.startsWith("COPILOT_GOAL_")) {
    res.status(400).json({ code: 1, message: error.message, details: { code: error.code } });
    return;
  }
  const message = error instanceof Error ? error.message : '';
  const code = error instanceof AgentError ? error.code
    : /^(?:COPILOT_|DEVELOPMENT_|SHELL_|SESSION_|PLATFORM_)[A-Z0-9_]+/.exec(message)?.[0]
      ?? (/expired/i.test(message) ? 'COPILOT_APPROVAL_EXPIRED'
        : /stale|revision|mismatch/i.test(message) ? 'COPILOT_APPROVAL_CHANGED'
          : /not approved|denied|disabled|authority|not active/i.test(message) ? 'COPILOT_APPROVAL_DENIED' : 'COPILOT_OPERATION_FAILED');
  res.status(400).json({ code: 1, message: "Copilot operation rejected", details: { code } });
}
