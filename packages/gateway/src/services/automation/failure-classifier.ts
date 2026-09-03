/**
 * Failure classification for scheduled automation runs.
 *
 * Maps stable AgentError codes to a user-readable category + suggested action
 * so the automations UI can show the operator what went wrong without dumping
 * provider payloads or stack traces.
 */
import { AgentError } from "../agent/types.js";

export interface ClassifiedFailure {
  code: string;
  category: "no_model" | "inactive" | "blocked" | "rate_limit" | "generic";
  message: string;
  suggestion: string;
}

export function classifyAutomationFailure(error: unknown): ClassifiedFailure {
  const code = error instanceof AgentError ? error.code : "AGENT_LLM_FAILED";
  const rawMessage = error instanceof Error ? error.message : "Automation run failed";
  switch (code) {
    case "AGENT_NO_MODEL":
      return {
        code,
        category: "no_model",
        message: rawMessage,
        suggestion: "在模型中心配置一个默认模型。"
      };
    case "AGENT_NO_CREDENTIAL":
      return {
        code,
        category: "no_model",
        message: rawMessage,
        suggestion: "在模型中心配置 provider 凭据。"
      };
    case "AGENT_MODEL_INACTIVE":
    case "AGENT_PROVIDER_INACTIVE":
      return {
        code,
        category: "inactive",
        message: rawMessage,
        suggestion: "启用或更换模型/供应商。"
      };
    case "AGENT_HOST_BLOCKED":
      return {
        code,
        category: "blocked",
        message: rawMessage,
        suggestion: "检查出站网络策略。"
      };
    default:
      return {
        code,
        category: classifyHttp(code, rawMessage),
        message: rawMessage,
        suggestion: "查看 run 详情。"
      };
  }
}

function classifyHttp(code: string, message: string): ClassifiedFailure["category"] {
  if (code === "AGENT_HTTP_ERROR" && /429\b|rate limit|usage limit/iu.test(message)) {
    return "rate_limit";
  }
  return "generic";
}
