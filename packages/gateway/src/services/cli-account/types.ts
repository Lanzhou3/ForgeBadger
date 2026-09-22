/**
 * cli-account subsystem: read-only observation of each CLI's native login
 * state (OAuth / subscription) and subscription quota. opencode and pi are
 * reserved for a later phase — they have no native account/quota surface yet.
 */
export type CliAccountAdapter = "claude" | "codex" | "kimi";

export type CliLoginState = "ready" | "not_authenticated" | "cli_missing" | "unknown";

export interface CliLoginStatus {
  adapter: CliAccountAdapter;
  state: CliLoginState;
  /** Login method, e.g. claude "claude.ai", codex "chatgpt"|"api", kimi "oauth"|"api_key". */
  method?: string;
  /** Human-facing account hint (e.g. email) when the CLI exposes one. */
  accountLabel?: string;
  /**
   * Machine-readable qualifier for ambiguous states (e.g. "token_expired",
   * or claude's exit-0-but-loggedIn:false third-party-gateway false positive,
   * where the original payload value is passed through verbatim).
   */
  detailCode?: string;
}

export type CliQuotaUnsupportedReason =
  | "keychain"
  | "no_native_login"
  | "api_key_mode"
  | "token_expired"
  | "upstream_error";

export interface CliQuotaEntry {
  label: string;
  unit: "percent" | "count" | "currency";
  /** 0-100 usage percentage when the endpoint reports one. */
  usedPercent?: number;
  remaining?: number;
  limit?: number;
  /** ISO timestamp when the quota window resets, when reported. */
  resetsAt?: string;
}

export interface CliQuotaResult {
  supported: boolean;
  unsupportedReason?: CliQuotaUnsupportedReason;
  planLabel?: string;
  entries: CliQuotaEntry[];
  fetchedAt: string;
}

export interface CliAccountOverview {
  login: CliLoginStatus;
  quota?: CliQuotaResult;
}
