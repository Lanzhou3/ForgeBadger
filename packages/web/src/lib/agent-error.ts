import type { TranslationKey } from "./i18n";

/**
 * Maps gateway Copilot/agent error codes (persisted on `copilot_runs.error`)
 * to user-facing i18n keys under `copilot.error.*`. Codes without an entry
 * fall back to `copilot.error.unknown`, and the raw code is kept as muted
 * diagnostic subtext by the render sites so troubleshooting stays possible.
 */
export const AGENT_ERROR_KEYS: Record<string, TranslationKey> = {
  AGENT_NO_MODEL: "copilot.error.noModel",
  AGENT_MODEL_INACTIVE: "copilot.error.modelInactive",
  AGENT_PROVIDER_INACTIVE: "copilot.error.providerInactive",
  AGENT_MODEL_NOT_CHAT: "copilot.error.modelNotChat",
  AGENT_MODEL_TRANSPORT_UNSUPPORTED: "copilot.error.transportUnsupported",
  AGENT_NO_CREDENTIAL: "copilot.error.noCredential",
  AGENT_NO_BASE_URL: "copilot.error.noBaseUrl",
  AGENT_HOST_BLOCKED: "copilot.error.hostBlocked",
  AGENT_HTTP_ERROR: "copilot.error.httpError",
  AGENT_LLM_FAILED: "copilot.error.llmFailed",
  AGENT_LLM_INVALID_RESPONSE: "copilot.error.invalidResponse",
  AGENT_CONTEXT_OVERFLOW: "copilot.error.contextOverflow",
  COPILOT_CONTEXT_TOO_LARGE: "copilot.error.contextTooLarge",
  AGENT_OUTPUT_LIMIT: "copilot.error.outputLimit",
  COPILOT_LEASE_LOST: "copilot.error.leaseLost",
  COPILOT_LEASE_RENEW_FAILED: "copilot.error.leaseLost",
  COPILOT_RUNTIME_STOPPED: "copilot.error.runtimeStopped",
  COPILOT_APPROVAL_DENIED: "copilot.error.approvalDenied",
  COPILOT_SENSITIVE_TOOL_INPUT: "copilot.error.sensitiveInput",
  COPILOT_TOOL_UNAVAILABLE: "copilot.error.toolUnavailable",
  COPILOT_TOOL_DISABLED: "copilot.error.toolUnavailable",
  PROJECT_NOT_FOUND: "copilot.error.projectNotFound",
  COPILOT_PROJECT_NOT_FOUND: "copilot.error.projectNotFound",
  COPILOT_CONVERSATION_BUSY: "copilot.error.conversationBusy",
  COPILOT_USER_INACTIVE: "copilot.error.userInactive",
  COPILOT_QUEUE_FULL: "copilot.error.queueFull",
  COPILOT_REQUEST_KEY_INVALID: "copilot.error.requestConflict",
  COPILOT_REQUEST_CONFLICT: "copilot.error.requestConflict",
  COPILOT_MODEL_INVALID: "copilot.error.modelInvalid",
};

export function agentErrorTranslationKey(code: string | null | undefined): TranslationKey | undefined {
  return code ? AGENT_ERROR_KEYS[code] : undefined;
}

export function isKnownAgentErrorCode(code: string): boolean {
  return Object.hasOwn(AGENT_ERROR_KEYS, code);
}
