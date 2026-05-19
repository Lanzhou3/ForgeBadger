import {
  runCommand,
  type CommandResult,
  type CommandRunnerOptions
} from "../../lib/dependency-check.js";

export type FeishuAuthState = "authenticated" | "unauthenticated" | "unknown";
export type FeishuIdentityMode = "user" | "bot" | "unknown";

export interface FeishuCliStatus {
  available: boolean;
  version?: string;
  authState: FeishuAuthState;
  identityMode: FeishuIdentityMode;
  enabled: boolean;
  emergencyDisabled?: boolean;
  error?: string;
}

export type FeishuCliCommandRunner = (
  command: string,
  args: string[],
  options?: CommandRunnerOptions
) => Promise<CommandResult>;

export interface GetFeishuCliStatusOptions {
  executable?: string;
  runner?: FeishuCliCommandRunner;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

const DEFAULT_EXECUTABLE = "lark-cli";
const DEFAULT_TIMEOUT_MS = 3000;
const VERSION_ARGS = ["--version"] as const;
const AUTH_STATUS_ARGS = ["auth", "status"] as const;

export async function getFeishuCliStatus(
  options: GetFeishuCliStatusOptions = {}
): Promise<FeishuCliStatus> {
  const runner = options.runner ?? runCommand;
  const executable = resolveExecutable(options);
  const commandOptions = { timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS };
  const versionResult = await runFeishuCommand(runner, executable, [...VERSION_ARGS], commandOptions);

  if (!versionResult || versionResult.exitCode !== 0) {
    return unavailableStatus();
  }

  const version = versionResult.stdout.trim();
  const authResult = await runFeishuCommand(runner, executable, [...AUTH_STATUS_ARGS], commandOptions);
  const authStatus = authResult ? parseAuthStatus(authResult) : unknownAuthStatus();

  return {
    available: true,
    ...(version ? { version } : {}),
    authState: authStatus.authState,
    identityMode: authStatus.identityMode,
    enabled: false
  };
}

async function runFeishuCommand(
  runner: FeishuCliCommandRunner,
  executable: string,
  args: string[],
  options: CommandRunnerOptions
): Promise<CommandResult | undefined> {
  try {
    return await runner(executable, args, options);
  } catch {
    return undefined;
  }
}

function resolveExecutable(options: GetFeishuCliStatusOptions): string {
  const configured = options.executable ?? options.env?.OPENFORGE_FEISHU_CLI_PATH;
  return typeof configured === "string" && configured.trim().length > 0
    ? configured.trim()
    : DEFAULT_EXECUTABLE;
}

function unavailableStatus(): FeishuCliStatus {
  return {
    available: false,
    authState: "unknown",
    identityMode: "unknown",
    enabled: false,
    error: "Feishu CLI unavailable"
  };
}

function parseAuthStatus(result: CommandResult): Pick<FeishuCliStatus, "authState" | "identityMode"> {
  if (result.exitCode !== 0) {
    return unknownAuthStatus();
  }

  const parsed = parseStructuredOutput(result.stdout);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return unknownAuthStatus();
  }

  return {
    authState: normalizeAuthState(parsed),
    identityMode: normalizeIdentityMode(parsed)
  };
}

function parseStructuredOutput(output: string): Record<string, unknown> | undefined {
  const trimmed = output.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Some commands include progress lines before JSON; fall through to NDJSON parsing.
  }

  for (const line of trimmed.split(/\r?\n/)) {
    const candidate = line.trim();
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function normalizeAuthState(payload: Record<string, unknown>): FeishuAuthState {
  const explicit = stringValue(payload.authState ?? payload.auth_state ?? payload.status ?? payload.tokenStatus);
  if (explicit) {
    if (["authenticated", "logged_in", "login", "active", "ok", "valid"].includes(explicit)) {
      return "authenticated";
    }
    if (["unauthenticated", "not_authenticated", "logged_out", "logout", "inactive", "invalid", "expired"].includes(explicit)) {
      return "unauthenticated";
    }
  }

  if (payload.authenticated === true || payload.isAuthenticated === true) {
    return "authenticated";
  }
  if (payload.authenticated === false || payload.isAuthenticated === false) {
    return "unauthenticated";
  }

  return "unknown";
}

function normalizeIdentityMode(payload: Record<string, unknown>): FeishuIdentityMode {
  const value = stringValue(payload.identityMode ?? payload.identity_mode ?? payload.identity ?? payload.mode ?? payload.type);
  if (value === "user" || value === "bot") {
    return value;
  }
  return "unknown";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim().toLowerCase() : undefined;
}

function unknownAuthStatus(): Pick<FeishuCliStatus, "authState" | "identityMode"> {
  return {
    authState: "unknown",
    identityMode: "unknown"
  };
}
