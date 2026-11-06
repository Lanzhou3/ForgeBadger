/**
 * Anthropic request-body rectifiers for the Claude route data plane.
 *
 * Third-party relays that implement the Anthropic Messages protocol but are
 * not (or no longer) backed by the model that produced a conversation's
 * thinking blocks reject the next turn with 400 errors such as
 * "Invalid `signature` in `thinking` block", "signature: Field required",
 * or "signature: Extra inputs are not permitted". Claude Code treats 400 as
 * fatal and aborts the turn; it has no way to repair its own request
 * history. These rectifiers detect those specific error messages upstream
 * and rewrite the request so it can be resent once — transparently, before
 * the client ever sees the error.
 *
 * The pattern set is deliberately broad (case-insensitive substring matches,
 * nested-JSON encodings included) because relays rephrase the same rejection
 * in many shapes; error bodies are matched as plain strings and never stored
 * or echoed beyond a redacted log snippet.
 */

export interface SignatureRectifyResult {
  applied: boolean;
  removedThinkingBlocks: number;
  removedRedactedThinkingBlocks: number;
  removedSignatureFields: number;
  removedTopLevelThinking: boolean;
}

export interface BudgetRectifyResult {
  applied: boolean;
  /** thinking.budget_tokens before / after (null when absent). */
  budgetTokensBefore: number | null;
  budgetTokensAfter: number | null;
  maxTokensBefore: number | null;
  maxTokensAfter: number | null;
}

/**
 * Detect upstream 400 messages that indicate thinking/signature
 * incompatibility. The message is matched case-insensitively on the
 * provider's own error text (including nested JSON encodings that some
 * relays double-escape).
 */
export function shouldRectifyThinkingSignature(errorMessage: string | undefined): boolean {
  if (!errorMessage) return false;
  const lower = errorMessage.toLowerCase();

  // "Invalid 'signature' in 'thinking' block"
  if (lower.includes("invalid") && lower.includes("signature")
    && lower.includes("thinking") && lower.includes("block")) {
    return true;
  }
  // "Unable to submit request because Thought signature is not valid"
  if (lower.includes("thought signature")
    && (lower.includes("not valid") || lower.includes("invalid"))) {
    return true;
  }
  // "a final `assistant` message must start with a thinking block"
  if (lower.includes("must start with a thinking block")) return true;
  // "Expected `thinking` or `redacted_thinking`, but found `tool_use`"
  // Require an explicit tool_use to avoid over-matching other 400s.
  if (lower.includes("expected") && (lower.includes("thinking") || lower.includes("redacted_thinking"))
    && lower.includes("found") && lower.includes("tool_use")) {
    return true;
  }
  // "xxx.signature: Field required"
  if (lower.includes("signature") && lower.includes("field required")) return true;
  // "xxx.signature: Extra inputs are not permitted"
  if (lower.includes("signature") && lower.includes("extra inputs are not permitted")) return true;
  // "thinking or redacted_thinking blocks ... cannot be modified"
  if ((lower.includes("thinking") || lower.includes("redacted_thinking"))
    && lower.includes("cannot be modified")) {
    return true;
  }
  // Catch-all for relays that wrap the rejection in a generic message.
  if (lower.includes("非法请求") || lower.includes("illegal request") || lower.includes("invalid request")) {
    return true;
  }
  return false;
}

/**
 * Detect upstream 400 messages about the thinking budget constraint
 * ("thinking.budget_tokens must be greater than or equal to 1024" and its
 * variants). Only then is the budget rewrite worth a retry.
 */
export function shouldRectifyThinkingBudget(errorMessage: string | undefined): boolean {
  if (!errorMessage) return false;
  const lower = errorMessage.toLowerCase();
  const hasBudgetTokens = lower.includes("budget_tokens") || lower.includes("budget tokens");
  const hasThinking = lower.includes("thinking");
  const has1024Constraint = lower.includes("greater than or equal to 1024")
    || lower.includes(">= 1024")
    || (lower.includes("1024") && lower.includes("input should be"));
  return hasBudgetTokens && hasThinking && has1024Constraint;
}

/**
 * Minimally invasive repair of an Anthropic request rejected over
 * thinking/signature incompatibility:
 *
 * - removes `thinking` / `redacted_thinking` blocks from every message
 *   content array
 * - removes stray `signature` fields left on non-thinking blocks
 * - drops the top-level `thinking` parameter when it is `enabled` and the
 *   last assistant message (after block removal) starts with a non-thinking
 *   block while still containing tool_use — the "must start with a thinking
 *   block" case
 *
 * Mutates `body` in place. `applied` is false when nothing changed, which
 * the caller uses to avoid a pointless retry.
 */
export function rectifyAnthropicSignature(body: Record<string, unknown>): SignatureRectifyResult {
  const result: SignatureRectifyResult = {
    applied: false,
    removedThinkingBlocks: 0,
    removedRedactedThinkingBlocks: 0,
    removedSignatureFields: 0,
    removedTopLevelThinking: false
  };

  const messages = Array.isArray(body.messages)
    ? (body.messages as Array<Record<string, unknown>>)
    : [];

  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const content = message.content;
    if (!Array.isArray(content)) continue;

    const blocks = content as Array<Record<string, unknown>>;
    const kept: Array<Record<string, unknown>> = [];
    let modified = false;

    for (const block of blocks) {
      const blockType = block?.type;
      if (blockType === "thinking") {
        result.removedThinkingBlocks += 1;
        modified = true;
        continue;
      }
      if (blockType === "redacted_thinking") {
        result.removedRedactedThinkingBlocks += 1;
        modified = true;
        continue;
      }
      if (block && typeof block === "object" && block.signature !== undefined) {
        const copy = { ...block };
        delete copy.signature;
        result.removedSignatureFields += 1;
        modified = true;
        kept.push(copy);
        continue;
      }
      kept.push(block);
    }

    if (modified) {
      message.content = kept;
      result.applied = true;
    }
  }

  // Fallback: thinking enabled + the last assistant message no longer starts
  // with a thinking block but still carries tool_use.
  if (shouldRemoveTopLevelThinking(body, messages)) {
    delete body.thinking;
    result.applied = true;
    result.removedTopLevelThinking = true;
  }

  return result;
}

function shouldRemoveTopLevelThinking(
  body: Record<string, unknown>,
  messages: Array<Record<string, unknown>>
): boolean {
  const thinking = body.thinking as Record<string, unknown> | undefined;
  // Only type=enabled is considered on; adaptive/absent are left untouched.
  if (!thinking || typeof thinking !== "object" || thinking.type !== "enabled") return false;

  const lastAssistant = [...messages].reverse().find(
    (message) => message?.role === "assistant"
  );
  const content = lastAssistant?.content;
  if (!Array.isArray(content) || content.length === 0) return false;

  const firstBlock = content[0] as Record<string, unknown> | undefined;
  const firstType = firstBlock?.type;
  const missingThinkingPrefix = firstType !== "thinking" && firstType !== "redacted_thinking";
  if (!missingThinkingPrefix) return false;

  return content.some((block) => (block as Record<string, unknown>)?.type === "tool_use");
}

/**
 * Repair of an Anthropic request rejected over the thinking budget
 * constraint: force `thinking.type = "enabled"` with a large-enough
 * `budget_tokens`, and raise `max_tokens` above the budget when needed.
 *
 * `adaptive` thinking requests are never rewritten (the constraint only
 * applies to the explicit enabled shape). Mutates `body` in place.
 */
export function rectifyAnthropicBudget(body: Record<string, unknown>): BudgetRectifyResult {
  const thinkingBefore = (body.thinking as Record<string, unknown> | undefined) ?? null;
  const before = budgetSnapshot(body, thinkingBefore);

  if (thinkingBefore?.type === "adaptive") {
    return {
      applied: false,
      budgetTokensBefore: before.budgetTokensBefore,
      budgetTokensAfter: before.budgetTokensBefore,
      maxTokensBefore: before.maxTokensBefore,
      maxTokensAfter: before.maxTokensBefore
    };
  }

  const thinking: Record<string, unknown> =
    thinkingBefore && typeof thinkingBefore === "object" ? thinkingBefore : {};
  thinking.type = "enabled";
  thinking.budget_tokens = 32000;
  body.thinking = thinking;

  let maxTokensAfter = before.maxTokensBefore;
  if (maxTokensAfter === null || maxTokensAfter < 32001) {
    maxTokensAfter = 64000;
    body.max_tokens = maxTokensAfter;
  }

  return {
    applied: before.budgetTokensBefore !== 32000 || maxTokensAfter !== before.maxTokensBefore,
    budgetTokensBefore: before.budgetTokensBefore,
    budgetTokensAfter: 32000,
    maxTokensBefore: before.maxTokensBefore,
    maxTokensAfter
  };
}

interface BudgetSnapshot {
  budgetTokensBefore: number | null;
  maxTokensBefore: number | null;
}

function budgetSnapshot(body: Record<string, unknown>, thinking: Record<string, unknown> | null): BudgetSnapshot {
  return {
    budgetTokensBefore: toPositiveInt(thinking?.budget_tokens),
    maxTokensBefore: toPositiveInt(body.max_tokens)
  };
}

function toPositiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
