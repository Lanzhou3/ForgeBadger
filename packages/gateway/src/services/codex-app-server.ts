import type { CredentialMode, LaunchPlan } from "../adapters/claude.js";
import {
  createCodexAppServerInitializeRequest as createJsonRpcInitializeRequest,
  createCodexAppServerThreadStartRequest as createJsonRpcThreadStartRequest,
  createCodexAppServerTurnStartRequest as createJsonRpcTurnStartRequest,
  type CodexInitializeRequestInput,
  type CodexThreadStartRequestInput,
  type CodexTurnStartRequestInput
} from "./codex-app-server-client.js";

export type CodexAppServerAuth =
  | { mode: "none" }
  | { mode: "capability-token"; tokenFile: string };

export interface CodexAppServerLaunchPlanInput {
  projectRoot: string;
  credentialMode: CredentialMode;
  listen?: string;
  wsAuth?: CodexAppServerAuth;
  env?: Record<string, string>;
  secretEnvNames?: string[];
}

export function createCodexAppServerLaunchPlan(
  input: CodexAppServerLaunchPlanInput
): LaunchPlan {
  const args = ["app-server", "--listen", input.listen ?? "stdio://"];

  if (input.wsAuth?.mode === "capability-token") {
    args.push("--ws-auth", "capability-token", "--ws-token-file", input.wsAuth.tokenFile);
  }

  return {
    command: "codex",
    args,
    cwd: input.projectRoot,
    env: input.env ?? {},
    secretEnvNames:
      input.credentialMode === "stored_encrypted_key"
        ? input.secretEnvNames ?? []
        : [],
    credentialMode: input.credentialMode
  };
}

export function createCodexAppServerInitializeRequest(
  input: CodexInitializeRequestInput
) {
  return createJsonRpcInitializeRequest(input);
}

export function createCodexThreadStartRequest(input: CodexThreadStartRequestInput) {
  return createJsonRpcThreadStartRequest(input);
}

export function createCodexTurnStartRequest(input: CodexTurnStartRequestInput) {
  return createJsonRpcTurnStartRequest(input);
}
