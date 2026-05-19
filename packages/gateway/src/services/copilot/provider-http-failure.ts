import { redactCopilotText } from "./redaction.js";
import type { CopilotModelEvent } from "./types.js";

export function providerHttpFailure(status: number, message: string | undefined): CopilotModelEvent[] {
  return [{
    type: "run_failed",
    code: providerHttpFailureCode(status),
    message: redactCopilotText(message ?? `Provider request failed with HTTP ${status}`)
  }];
}

function providerHttpFailureCode(status: number): string {
  if (status === 401 || status === 403) return "copilot_provider_auth_failed";
  if (status === 429) return "copilot_provider_rate_limited";
  if (status >= 500 && status <= 599) return "copilot_provider_unavailable";
  return "copilot_provider_request_failed";
}
