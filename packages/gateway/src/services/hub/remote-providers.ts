import { z } from "zod";

import { assertResolvedPublicHttpsEndpoint } from "../network-policy.js";

export type RemoteProviderId = "github" | "gitee";
export type PullRequestState = "open" | "closed" | "merged";
export type CiState = "success" | "failure" | "pending" | "none";

export interface RemoteRepository { owner: string; repo: string }
export interface RemotePullRequest { number: number; url: string; state: PullRequestState; draft: boolean; headSha: string }
export interface RemoteCiStatus { state: CiState; total: number; failed: number }

export interface RemoteProviderIO {
  fetch?: typeof fetch;
  validate?: typeof assertResolvedPublicHttpsEndpoint;
}

export interface RemoteProviderClient {
  findPullRequest(input: RemoteRepository & { branch: string; sha: string; prUrl: string | null }): Promise<RemotePullRequest | null>;
  commitStatus(input: RemoteRepository & { sha: string }): Promise<RemoteCiStatus>;
}

/** Stable, secret-free error. `message` is always the code. */
export class RemoteError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "RemoteError";
  }
}

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const PROVIDER_HOSTS: Record<RemoteProviderId, string> = { github: "github.com", gitee: "gitee.com" };
// Fixed constants: nothing a caller or stored setting provides can redirect the API traffic.
const API_BASES: Record<RemoteProviderId, string> = { github: "https://api.github.com", gitee: "https://gitee.com/api/v5" };

/** Accepts only `https://<host>/owner/repo(.git)` and `git@<host>:owner/repo(.git)` for the provider's own host. */
export function parseRepository(provider: RemoteProviderId, remoteUrl: string): RemoteRepository {
  const unsupported = () => new RemoteError("REMOTE_REPOSITORY_UNSUPPORTED");
  const host = PROVIDER_HOSTS[provider];
  if (!host) throw unsupported();
  let path: string | undefined;
  const ssh = /^git@([A-Za-z0-9.-]+):(.+)$/.exec(remoteUrl);
  if (ssh) {
    if (ssh[1]!.toLowerCase() === host) path = ssh[2];
  } else {
    try {
      const url = new URL(remoteUrl);
      const plain = url.protocol === "https:" && !url.username && !url.password && !url.port && !url.search && !url.hash;
      if (plain && url.hostname.toLowerCase() === host) path = url.pathname.replace(/^\//, "");
    } catch {
      path = undefined;
    }
  }
  const parts = (path ?? "").replace(/\/$/, "").replace(/\.git$/, "").split("/");
  const [owner, repo] = parts;
  if (parts.length !== 2 || !owner || !repo || !NAME.test(owner) || !NAME.test(repo)) throw unsupported();
  return { owner, repo };
}

/** Extracts the PR number from a PR URL that belongs to exactly this provider host and repository. */
export function pullRequestNumberFromUrl(provider: RemoteProviderId, repository: RemoteRepository, prUrl: string | null): number | null {
  if (!prUrl) return null;
  try {
    const url = new URL(prUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.hostname.toLowerCase() !== PROVIDER_HOSTS[provider]) return null;
    const [owner, repo, kind, number, ...rest] = url.pathname.replace(/^\//, "").replace(/\/$/, "").split("/");
    const wanted = provider === "github" ? "pull" : "pulls";
    if (rest.length > 0 || kind !== wanted || !number || !/^[1-9][0-9]{0,9}$/.test(number)) return null;
    if (owner?.toLowerCase() !== repository.owner.toLowerCase() || repo?.toLowerCase() !== repository.repo.toLowerCase()) return null;
    return Number(number);
  } catch {
    return null;
  }
}

function safeHtmlUrl(provider: RemoteProviderId, value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.hostname.toLowerCase() === PROVIDER_HOSTS[provider] ? url.toString() : null;
  } catch {
    return null;
  }
}

class RemoteHttp {
  private readonly request: typeof fetch;
  private readonly validate: typeof assertResolvedPublicHttpsEndpoint;

  constructor(private readonly provider: RemoteProviderId, private readonly token: string | null, io: RemoteProviderIO) {
    this.request = io.fetch ?? fetch;
    this.validate = io.validate ?? assertResolvedPublicHttpsEndpoint;
  }

  /** GET relative to the fixed API base. Returns undefined on 404; otherwise parsed JSON. */
  async get(path: string): Promise<unknown | undefined> {
    const url = new URL(`${API_BASES[this.provider]}${path}`);
    try {
      await this.validate(url.origin);
    } catch {
      throw new RemoteError("REMOTE_UNREACHABLE");
    }
    let response: Response;
    try {
      response = await this.request(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: this.headers() });
    } catch {
      throw new RemoteError("REMOTE_UNREACHABLE");
    }
    if (response.status === 404) return undefined;
    if (response.status === 401 || response.status === 403 || response.status === 429) throw this.rejection(response);
    if (!response.ok) throw new RemoteError("REMOTE_RESPONSE_INVALID");
    return readJson(response);
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { Accept: this.provider === "github" ? "application/vnd.github+json" : "application/json", "User-Agent": "forgebadger-hub" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }

  private rejection(response: Response): RemoteError {
    const limited = response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after");
    return new RemoteError(limited ? "REMOTE_RATE_LIMITED" : "REMOTE_AUTH_REJECTED");
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    const reader = response.body?.getReader();
    if (!reader) return JSON.parse(await response.text()) as unknown;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("too large");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new RemoteError("REMOTE_RESPONSE_INVALID");
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new RemoteError("REMOTE_RESPONSE_INVALID");
  return result.data;
}

const pullSchema = z.object({
  number: z.number().int(),
  html_url: z.string(),
  state: z.string(),
  draft: z.boolean().nullish(),
  merged: z.boolean().nullish(),
  merged_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  head: z.object({ sha: z.string(), ref: z.string().nullish() }).passthrough()
}).passthrough();
type PullPayload = z.infer<typeof pullSchema>;

function toPullRequest(provider: RemoteProviderId, payload: PullPayload): RemotePullRequest | null {
  const url = safeHtmlUrl(provider, payload.html_url);
  if (!url) return null;
  const merged = payload.merged === true || Boolean(payload.merged_at) || payload.state === "merged";
  const state: PullRequestState = merged ? "merged" : payload.state === "open" ? "open" : "closed";
  return { number: payload.number, url, state, draft: payload.draft === true, headSha: payload.head.sha };
}

/**
 * The provider's `head` filter is not trusted: only PRs whose head ref is the
 * submission branch (or, lacking a ref, whose head sha is the submission
 * commit) are accepted. Prefer the matching commit, then the most recently updated.
 */
function pickPullRequest(items: PullPayload[], branch: string, sha: string): PullPayload | undefined {
  const same = (value: string) => value.toLowerCase() === sha.toLowerCase();
  const accepted = items.filter(item => (item.head.ref ? item.head.ref === branch : same(item.head.sha)));
  const updated = (item: PullPayload) => Date.parse(item.updated_at ?? "") || 0;
  return accepted.sort((a, b) => Number(same(b.head.sha)) - Number(same(a.head.sha)) || updated(b) - updated(a))[0];
}

const enc = encodeURIComponent;

abstract class BaseClient implements RemoteProviderClient {
  protected readonly http: RemoteHttp;

  constructor(protected readonly provider: RemoteProviderId, token: string | null, io: RemoteProviderIO) {
    this.http = new RemoteHttp(provider, token, io);
  }

  protected abstract listQuery(owner: string, branch: string): string;
  abstract commitStatus(input: RemoteRepository & { sha: string }): Promise<RemoteCiStatus>;

  async findPullRequest(input: RemoteRepository & { branch: string; sha: string; prUrl: string | null }): Promise<RemotePullRequest | null> {
    const { owner, repo } = input;
    const base = `/repos/${enc(owner)}/${enc(repo)}/pulls`;
    const number = pullRequestNumberFromUrl(this.provider, input, input.prUrl);
    if (number !== null) {
      const payload = await this.http.get(`${base}/${number}`);
      if (payload !== undefined) return toPullRequest(this.provider, parse(pullSchema, payload));
    }
    // A missing PR number falls through to the branch lookup, which also tells a missing repository apart.
    const list = await this.http.get(`${base}?${this.listQuery(owner, input.branch)}&state=all&per_page=5`);
    if (list === undefined) throw new RemoteError("REMOTE_REPOSITORY_NOT_FOUND");
    const found = pickPullRequest(parse(z.array(pullSchema), list), input.branch, input.sha);
    return found ? toPullRequest(this.provider, found) : null;
  }
}

const checkRunSchema = z.object({ status: z.string(), conclusion: z.string().nullish() }).passthrough();
const checkRunsSchema = z.object({ total_count: z.number().int(), check_runs: z.array(checkRunSchema) }).passthrough();
const combinedSchema = z.object({ state: z.string(), total_count: z.number().int().optional(), statuses: z.array(z.object({ state: z.string() }).passthrough()) }).passthrough();
const RUN_OK = new Set(["success", "neutral", "skipped"]);
const RUN_FAILED = new Set(["failure", "timed_out", "cancelled", "action_required", "stale", "startup_failure"]);

export class GithubClient extends BaseClient {
  constructor(token: string | null, io: RemoteProviderIO = {}) {
    super("github", token, io);
  }

  protected listQuery(owner: string, branch: string): string {
    return `head=${enc(`${owner}:${branch}`)}`;
  }

  async commitStatus({ owner, repo, sha }: RemoteRepository & { sha: string }): Promise<RemoteCiStatus> {
    const root = `/repos/${enc(owner)}/${enc(repo)}/commits/${enc(sha)}`;
    const runsPayload = await this.http.get(`${root}/check-runs?per_page=100`);
    const statusPayload = await this.http.get(`${root}/status`);
    if (runsPayload === undefined || statusPayload === undefined) return { state: "none", total: 0, failed: 0 };
    const runs = parse(checkRunsSchema, runsPayload);
    const combined = parse(combinedSchema, statusPayload);
    const failedRuns = runs.check_runs.filter(run => run.status === "completed" && RUN_FAILED.has(run.conclusion ?? "")).length;
    const okRuns = runs.check_runs.filter(run => run.status === "completed" && RUN_OK.has(run.conclusion ?? "")).length;
    const statuses = combined.statuses;
    const failedStatuses = statuses.filter(item => item.state === "failure" || item.state === "error").length;
    const okStatuses = statuses.filter(item => item.state === "success").length;
    const total = runs.check_runs.length + statuses.length;
    const failed = failedRuns + failedStatuses;
    if (failed > 0) return { state: "failure", total, failed };
    if (total === 0 && runs.total_count === 0) return { state: "none", total: 0, failed: 0 };
    // Success is affirmative only when every listed run/status is positively good and nothing is truncated.
    const complete = runs.total_count <= runs.check_runs.length && okRuns + okStatuses === total
      && (statuses.length === 0 || combined.state === "success");
    return { state: complete && total > 0 ? "success" : "pending", total, failed: 0 };
  }
}

const giteeStatusesSchema = z.array(z.object({ state: z.string() }).passthrough());

export class GiteeClient extends BaseClient {
  constructor(token: string | null, io: RemoteProviderIO = {}) {
    super("gitee", token, io);
  }

  protected listQuery(_owner: string, branch: string): string {
    return `head=${enc(branch)}`;
  }

  /**
   * UNVERIFIED: the statuses endpoint has not been checked against official
   * Gitee documentation, so every non-affirmative outcome (404, non-array,
   * empty, unknown item state, any non-2xx other than auth/rate-limit) maps to
   * `none`, never `success`. Network failures (REMOTE_UNREACHABLE) and
   * auth/rate-limit rejections still propagate.
   */
  async commitStatus({ owner, repo, sha }: RemoteRepository & { sha: string }): Promise<RemoteCiStatus> {
    let payload: unknown;
    try {
      payload = await this.http.get(`/repos/${enc(owner)}/${enc(repo)}/commits/${enc(sha)}/statuses`);
    } catch (error) {
      if (error instanceof RemoteError && error.code === "REMOTE_RESPONSE_INVALID") return { state: "none", total: 0, failed: 0 };
      throw error;
    }
    const parsed = giteeStatusesSchema.safeParse(payload);
    if (!parsed.success || parsed.data.length === 0) return { state: "none", total: 0, failed: 0 };
    const items = parsed.data;
    const failed = items.filter(item => item.state === "failure" || item.state === "error").length;
    if (failed > 0) return { state: "failure", total: items.length, failed };
    const allOk = items.every(item => item.state === "success");
    return { state: allOk ? "success" : "pending", total: items.length, failed: 0 };
  }
}

export function createRemoteProvider(provider: RemoteProviderId, token: string | null, io: RemoteProviderIO = {}): RemoteProviderClient {
  return provider === "github" ? new GithubClient(token, io) : new GiteeClient(token, io);
}
