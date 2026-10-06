import { describe, expect, it } from "vitest";

import {
  AGENT_ERROR_KEYS,
  agentErrorTranslationKey,
  isKnownAgentErrorCode,
} from "./agent-error";
import { getTranslation, supportedLanguages, translations } from "./i18n";

describe("agent-error mapping", () => {
  it("maps every gateway code that can reach the UI to its i18n key", () => {
    expect(AGENT_ERROR_KEYS["AGENT_NO_MODEL"]).toBe("copilot.error.noModel");
    expect(AGENT_ERROR_KEYS["AGENT_MODEL_INACTIVE"]).toBe("copilot.error.modelInactive");
    expect(AGENT_ERROR_KEYS["AGENT_PROVIDER_INACTIVE"]).toBe("copilot.error.providerInactive");
    expect(AGENT_ERROR_KEYS["AGENT_MODEL_NOT_CHAT"]).toBe("copilot.error.modelNotChat");
    expect(AGENT_ERROR_KEYS["AGENT_MODEL_TRANSPORT_UNSUPPORTED"]).toBe("copilot.error.transportUnsupported");
    expect(AGENT_ERROR_KEYS["AGENT_NO_CREDENTIAL"]).toBe("copilot.error.noCredential");
    expect(AGENT_ERROR_KEYS["AGENT_NO_BASE_URL"]).toBe("copilot.error.noBaseUrl");
    expect(AGENT_ERROR_KEYS["AGENT_HOST_BLOCKED"]).toBe("copilot.error.hostBlocked");
    expect(AGENT_ERROR_KEYS["AGENT_HTTP_ERROR"]).toBe("copilot.error.httpError");
    expect(AGENT_ERROR_KEYS["AGENT_LLM_FAILED"]).toBe("copilot.error.llmFailed");
    expect(AGENT_ERROR_KEYS["AGENT_LLM_INVALID_RESPONSE"]).toBe("copilot.error.invalidResponse");
    expect(AGENT_ERROR_KEYS["AGENT_CONTEXT_OVERFLOW"]).toBe("copilot.error.contextOverflow");
    expect(AGENT_ERROR_KEYS["COPILOT_CONTEXT_TOO_LARGE"]).toBe("copilot.error.contextTooLarge");
    expect(AGENT_ERROR_KEYS["AGENT_OUTPUT_LIMIT"]).toBe("copilot.error.outputLimit");
    expect(AGENT_ERROR_KEYS["COPILOT_LEASE_LOST"]).toBe("copilot.error.leaseLost");
    expect(AGENT_ERROR_KEYS["COPILOT_LEASE_RENEW_FAILED"]).toBe("copilot.error.leaseLost");
    expect(AGENT_ERROR_KEYS["COPILOT_RUNTIME_STOPPED"]).toBe("copilot.error.runtimeStopped");
    expect(AGENT_ERROR_KEYS["COPILOT_APPROVAL_DENIED"]).toBe("copilot.error.approvalDenied");
    expect(AGENT_ERROR_KEYS["COPILOT_SENSITIVE_TOOL_INPUT"]).toBe("copilot.error.sensitiveInput");
    expect(AGENT_ERROR_KEYS["COPILOT_TOOL_UNAVAILABLE"]).toBe("copilot.error.toolUnavailable");
    expect(AGENT_ERROR_KEYS["COPILOT_TOOL_DISABLED"]).toBe("copilot.error.toolUnavailable");
    expect(AGENT_ERROR_KEYS["PROJECT_NOT_FOUND"]).toBe("copilot.error.projectNotFound");
    expect(AGENT_ERROR_KEYS["COPILOT_PROJECT_NOT_FOUND"]).toBe("copilot.error.projectNotFound");
    expect(AGENT_ERROR_KEYS["COPILOT_CONVERSATION_BUSY"]).toBe("copilot.error.conversationBusy");
    expect(AGENT_ERROR_KEYS["COPILOT_USER_INACTIVE"]).toBe("copilot.error.userInactive");
    expect(AGENT_ERROR_KEYS["COPILOT_QUEUE_FULL"]).toBe("copilot.error.queueFull");
    expect(AGENT_ERROR_KEYS["COPILOT_REQUEST_KEY_INVALID"]).toBe("copilot.error.requestConflict");
    expect(AGENT_ERROR_KEYS["COPILOT_REQUEST_CONFLICT"]).toBe("copilot.error.requestConflict");
    expect(AGENT_ERROR_KEYS["COPILOT_MODEL_INVALID"]).toBe("copilot.error.modelInvalid");
  });

  it("returns undefined for unknown or missing codes so callers fall back", () => {
    expect(agentErrorTranslationKey("SOME_FUTURE_CODE")).toBeUndefined();
    expect(agentErrorTranslationKey("COPILOT_FAILED")).toBeUndefined();
    expect(agentErrorTranslationKey("")).toBeUndefined();
    expect(agentErrorTranslationKey(undefined)).toBeUndefined();
    expect(agentErrorTranslationKey(null)).toBeUndefined();
    expect(isKnownAgentErrorCode("AGENT_NO_MODEL")).toBe(true);
    expect(isKnownAgentErrorCode("SOME_FUTURE_CODE")).toBe(false);
  });

  it("resolves every mapped key in all three languages", () => {
    const keys = new Set(Object.values(AGENT_ERROR_KEYS));
    expect(keys.size).toBeGreaterThan(10);
    for (const key of keys) {
      for (const language of supportedLanguages) {
        const text = getTranslation(language, key);
        expect(text, `${language} ${key}`).not.toBe(key);
        expect(text.length, `${language} ${key}`).toBeGreaterThan(4);
      }
    }
  });

  it("provides distinct fallback text for unmapped codes in all languages", () => {
    for (const language of supportedLanguages) {
      const text = translations[language]["copilot.error.unknown"];
      expect(text).toBeTruthy();
      expect(text).not.toContain("copilot.error.unknown");
      expect(getTranslation(language, "copilot.error.unknown")).toBe(text);
    }
  });
});
