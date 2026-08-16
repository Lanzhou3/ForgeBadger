import { digestPortfolioActionIntent } from "../../db/repositories/portfolio-repository.js";

export type AuthorizationTier = "preauthorized" | "owner_confirmation" | "protected";

export interface CanonicalActionIntentInput {
  userId: string;
  projectId: string;
  workItemId: string;
  attemptId: string;
  sessionId: string;
  actionClass: string;
  resourceScope: Record<string, unknown>;
  packetDigest: string;
  assignmentLeaseTokenDigest: string;
  issuedAt: Date;
  expiresAt: Date;
}

export interface CanonicalActionIntent extends CanonicalActionIntentInput {
  policyRule: string | null;
  digest: string;
}

export interface AuthorizationDecision {
  tier: AuthorizationTier;
  policyRule: string;
  action: CanonicalActionIntent;
}

const protectedClasses = new Set([
  "delete", "secret_access", "secret_change", "privilege_expansion", "external_publication", "cross_project", "arbitrary_shell", "raw_terminal_input"
]);

function actionIsProtected(input: CanonicalActionIntentInput): boolean {
  return protectedClasses.has(input.actionClass)
    || input.resourceScope.crossProject === true
    || input.resourceScope.externalPublication === true
    || input.resourceScope.secretAccess === true
    || input.resourceScope.rawShellText !== undefined
    || input.resourceScope.rawTerminalInput !== undefined;
}

/** Policy decisions are closed over server-created action facts, never model or channel text. */
export function createAuthorizationPolicy(input: { preauthorizedActionClasses?: string[] } = {}) {
  const preauthorized = new Set(input.preauthorizedActionClasses ?? []);

  function buildAction(inputValue: CanonicalActionIntentInput): CanonicalActionIntent {
    if (inputValue.expiresAt.getTime() <= inputValue.issuedAt.getTime()) throw new Error("PORTFOLIO_AUTHORIZATION_EXPIRED");
    const action = { ...inputValue, resourceScope: { ...inputValue.resourceScope }, policyRule: null };
    return { ...action, digest: digestPortfolioActionIntent({
      userId: inputValue.userId, projectId: inputValue.projectId, workItemId: inputValue.workItemId, attemptId: inputValue.attemptId,
      sessionId: inputValue.sessionId, actionClass: inputValue.actionClass, resourceScope: inputValue.resourceScope,
      payloadDigest: inputValue.packetDigest, assignmentLeaseTokenDigest: inputValue.assignmentLeaseTokenDigest,
      policyRule: null, issuedAt: inputValue.issuedAt, expiresAt: inputValue.expiresAt
    }) };
  }

  function classify(inputValue: CanonicalActionIntentInput): AuthorizationDecision {
    const action = buildAction(inputValue);
    if (actionIsProtected(action)) return decisionFor(action, "protected", "protected-action/v1");
    if (preauthorized.has(action.actionClass)) return decisionFor(action, "preauthorized", `preauthorized:${action.actionClass}/v1`);
    return decisionFor(action, "owner_confirmation", "owner-confirmation/v1");
  }

  function requirePreauthorization(inputValue: CanonicalActionIntentInput): AuthorizationDecision & { tier: "preauthorized" } {
    const decision = classify(inputValue);
    if (decision.tier === "protected") throw new Error("PORTFOLIO_PROTECTED_ACTION");
    if (decision.tier !== "preauthorized") throw new Error("PORTFOLIO_AUTHORIZATION_REQUIRED");
    return { ...decision, tier: "preauthorized" };
  }

  return { buildAction, classify, requirePreauthorization };
}

function decisionFor(action: CanonicalActionIntent, tier: AuthorizationTier, policyRule: string): AuthorizationDecision {
  const boundAction = { ...action, policyRule };
  return { tier, policyRule, action: { ...boundAction, digest: digestPortfolioActionIntent({
    userId: boundAction.userId, projectId: boundAction.projectId, workItemId: boundAction.workItemId,
    attemptId: boundAction.attemptId, sessionId: boundAction.sessionId, actionClass: boundAction.actionClass,
    resourceScope: boundAction.resourceScope, payloadDigest: boundAction.packetDigest,
    assignmentLeaseTokenDigest: boundAction.assignmentLeaseTokenDigest, policyRule, issuedAt: boundAction.issuedAt, expiresAt: boundAction.expiresAt
  }) } };
}
