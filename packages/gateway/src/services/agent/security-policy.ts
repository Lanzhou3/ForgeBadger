/**
 * Copilot security policy engine — Codex-style "auto" security model.
 *
 * The policy evaluates every tool call before it executes. It returns one of:
 *   - auto_approve: low-risk call, execute immediately
 *   - require_approval: escalate to a pending action for owner decision
 *   - deny: reject with an error result (model can recover)
 *
 * The default rules are intentionally conservative. Read tools are unaffected.
 * Operate tools default to require_approval unless a rule explicitly auto-approves
 * a constrained input (e.g. create_project under the user's home directory).
 */
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { DENIED_ROOTS } from "../../lib/safe-resolve.js";
import type { Database } from "../../db/types.js";

export type SecurityDecisionAction = "auto_approve" | "require_approval" | "deny";
export type RiskClass = "low" | "medium" | "high";

export interface SecurityDecision {
  action: SecurityDecisionAction;
  reason: string;
  riskClass: RiskClass;
}

export interface SecurityPolicyInput {
  userId: string;
  toolName: string;
  /** Tool risk tier declared at registration. */
  toolRisk: "read" | "operate";
  /** Tool owner's declared approval requirement. */
  requiresApproval: boolean;
  /** Parsed and validated tool input. */
  input: unknown;
}

export interface SecurityPolicyContext {
  homeDir?: string;
}

export function createSecurityPolicy(context?: SecurityPolicyContext) {
  const home = context?.homeDir ?? homedir();

  function evaluate(input: SecurityPolicyInput): SecurityDecision {
    // Global denylist first: traversal or known-dangerous patterns in any input.
    const dangerous = detectDangerousInput(input.input);
    if (dangerous) {
      return { action: "deny", reason: dangerous, riskClass: "high" };
    }

    // Read tools execute freely once dangerous patterns are ruled out.
    if (input.toolRisk === "read") {
      return { action: "auto_approve", reason: "read tool", riskClass: "low" };
    }

    // Tool explicitly marked as not requiring approval is still subject to denylist checks.
    const base = input.requiresApproval ? "require_approval" : "auto_approve";

    // Tool-specific rules.
    if (input.toolName === "create_project") {
      const decision = evaluateCreateProject(input.input, home);
      if (decision) return decision;
    }

    if (input.toolName === "advance_work_item") {
      return {
        action: "require_approval",
        reason: "state mutation requires owner confirmation",
        riskClass: "high"
      };
    }

    return {
      action: base as SecurityDecisionAction,
      reason: base === "auto_approve" ? "tool does not require approval" : "operate tool default approval gate",
      riskClass: input.requiresApproval ? "medium" : "low"
    };
  }

  return { evaluate };
}

function evaluateCreateProject(input: unknown, home: string): SecurityDecision | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const rawPath = (input as Record<string, unknown>).path;
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    return { action: "require_approval", reason: "missing project path", riskClass: "medium" };
  }

  if (containsTraversal(rawPath)) {
    return { action: "deny", reason: "path contains traversal segment", riskClass: "high" };
  }

  const expanded = expandHome(rawPath, home);
  if (!isAbsolute(expanded)) {
    return { action: "require_approval", reason: "relative project path; scope cannot be verified", riskClass: "medium" };
  }

  const normalized = resolve(expanded).toLowerCase();

  if (isUnderDeniedRoot(normalized)) {
    return { action: "deny", reason: "project path is under a denied system root", riskClass: "high" };
  }

  const homeLower = resolve(home).toLowerCase();
  if (!normalized.startsWith(homeLower + "/") && normalized !== homeLower) {
    return { action: "require_approval", reason: "project path outside home directory", riskClass: "high" };
  }

  return { action: "auto_approve", reason: "project path is within home directory", riskClass: "low" };
}

function detectDangerousInput(input: unknown): string | undefined {
  const text = JSON.stringify(input);
  if (text.includes("../") || text.includes("..\\")) {
    return "input contains path traversal";
  }
  if (/\b(rm -rf|mkfs|dd if=|>:)\b/.test(text)) {
    return "input contains potentially destructive shell pattern";
  }
  return undefined;
}

function expandHome(value: string, home: string): string {
  if (value === "~") return home;
  if (value.startsWith("~/")) return `${home}${value.slice(1)}`;
  if (value.startsWith("~\\")) return `${home}${value.slice(1)}`;
  return value;
}

function containsTraversal(value: string): boolean {
  const parts = value.split(/[\\/]+/);
  return parts.some((part) => part === "..");
}

function isUnderDeniedRoot(normalizedPath: string): boolean {
  for (const root of DENIED_ROOTS) {
    const r = root.toLowerCase();
    if (normalizedPath === r || normalizedPath.startsWith(`${r}/`)) {
      return true;
    }
  }
  return false;
}

export interface OperationLogInput {
  db: Database;
  userId: string;
  operation: string;
  input: unknown;
  action: SecurityDecisionAction;
  reason: string;
}

/** Durable audit record of every policy decision. Idempotent by input digest. */
export function logSecurityDecision(input: OperationLogInput): void {
  const id = randomUUID();
  const idempotencyKey = createHash("sha256").update(JSON.stringify(input.input)).digest("hex");
  const payloadDigest = idempotencyKey;
  const resultJson = JSON.stringify({ action: input.action, reason: input.reason });
  input.db.prepare(`
    INSERT INTO copilot_operation_log (id, user_id, operation, idempotency_key, payload_digest, result_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.userId, input.operation, idempotencyKey, payloadDigest, resultJson, Date.now());
}
