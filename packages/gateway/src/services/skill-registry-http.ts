import { lookup } from "node:dns/promises";
import { publicFetch } from "./extensions/public-fetch.js";
import { validateOutboundHost } from "./network-policy.js";
import {
  boundedBuffer,
  type GitHubRequestOptions,
} from "./github-skill-source.js";

const hosts = new Set([
  "clawhub.ai",
  "www.clawhub.ai",
  "skills.sh",
  "www.skills.sh",
  "raw.githubusercontent.com",
  "gist.githubusercontent.com",
]);
export class SkillRegistryHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter: number | undefined,
  ) {
    super(
      `Skill source returned HTTP ${status}${retryAfter ? `; retry after ${retryAfter}s` : ""}`,
    );
  }
}

export async function registryText(
  url: string,
  options: GitHubRequestOptions = {},
  maxBytes = 1024 * 1024,
): Promise<string> {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !hosts.has(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    (parsed.port && parsed.port !== "443")
  )
    throw new Error("Unsupported Skill source URL");
  const rejection = await validateOutboundHost(
    parsed.hostname,
    options.resolveHost ?? lookup,
  );
  if (rejection) throw new Error(`Skill source rejected: ${rejection}`);
  const timeout = AbortSignal.timeout(
    Math.min(options.timeoutMs ?? 10000, 30000),
  );
  const signal = options.signal
    ? AbortSignal.any([timeout, options.signal])
    : timeout;
  const response = options.fetcher
    ? await options.fetcher(parsed.href, { signal, redirect: "error" })
    : await publicFetch(parsed.href, { signal }, undefined, {
        allowQuery: true,
        maxResponseBytes: maxBytes,
      });
  if (!response.ok) {
    await response.body?.cancel();
    const retry = Number(response.headers.get("retry-after"));
    throw new SkillRegistryHttpError(
      response.status,
      Number.isFinite(retry) && retry > 0 ? Math.min(retry, 3600) : undefined,
    );
  }
  const bytes = await boundedBuffer(response, maxBytes);
  if (bytes.byteLength > maxBytes)
    throw new Error("Skill source exceeds size limit");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function registryJson(
  url: string,
  options: GitHubRequestOptions = {},
): Promise<unknown> {
  return JSON.parse(await registryText(url, options));
}
