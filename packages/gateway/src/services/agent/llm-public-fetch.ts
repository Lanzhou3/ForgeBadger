import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest, type IncomingMessage, type ClientRequest } from "node:http";
import { isIP, type LookupFunction } from "node:net";
import { setTimeout as delay } from 'node:timers/promises';
import { assertResolvedPublicHttpsEndpoint, isBlockedCloudMetadataHost, type OutboundHostResolver } from "../network-policy.js";
import { AgentError } from "./types.js";
import { MAX_RESPONSE_BYTES, withAbort } from "./llm-response.js";
import { canRetryConnection, connectionError, LlmConnectionError, type ConnectionStage, type RequestDelivery } from './llm-connection-error.js';

export interface ConnectionProgress { stage: ConnectionStage; delivery: RequestDelivery; attempts: number; startedAt: number }

interface PublicFetchOptions {
  onProgress?: (progress: ConnectionProgress) => void;
  resolveHost?: OutboundHostResolver;
  allowPlaintextHttp?: boolean;
  allowPrivateNetworks?: boolean;
  /** External socket boundary for tests; production selects Node HTTP(S) by protocol. */
  requestImpl?: typeof httpsRequest;
}

async function validatedAddresses(url: URL, options: PublicFetchOptions, signal: AbortSignal) {
  let addresses: Awaited<ReturnType<OutboundHostResolver>> = [];
  let dnsFailure: LlmConnectionError | undefined;
  const resolve: OutboundHostResolver = async (hostname, lookupOptions) => {
    try {
      addresses = options.resolveHost ? await options.resolveHost(hostname, lookupOptions) : await lookup(hostname, { all: true });
      if (!addresses.length) throw Object.assign(new Error('Empty DNS result'), { code: 'ENODATA' });
      return addresses;
    } catch (error) {
      dnsFailure = connectionError(error, 'dns', 'not_sent', signal);
      throw dnsFailure;
    }
  };
  try {
    await withAbort(assertResolvedPublicHttpsEndpoint(url.href, resolve, options), signal);
    if (url.hash || url.search) throw new Error("Ambiguous provider endpoint");
    // Explicitly trusted private hosts bypass network-policy DNS checks. Still
    // resolve once and pin the actual socket; metadata remains policy-blocked.
    if (!addresses.length) {
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      const family = isIP(hostname);
      if (family) addresses = [{ address: hostname, family }];
      else await withAbort(resolve(hostname, { all: true }), signal);
    }
    if (addresses.some(entry => isMetadataAddress(entry.address))) throw new Error('Metadata address blocked');
    return addresses;
  } catch (error) {
    if (signal.aborted) throw connectionError(error, 'dns', 'not_sent', signal);
    if (dnsFailure) throw dnsFailure;
    throw new AgentError("AGENT_HOST_BLOCKED", "Provider endpoint failed public-network validation");
  }
}

/** Canonicalize mapped/translated IPs before applying the existing metadata deny rule. */
function isMetadataAddress(address: string): boolean {
  if (isBlockedCloudMetadataHost(address)) return true;
  if (!address.includes(':')) return false;
  const value = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  if (value === 'fd00:ec2::254') return true;
  let tail: string | undefined;
  if (value.startsWith('::ffff:')) tail = value.slice(7);
  if (value.startsWith('64:ff9b::')) tail = value.slice(9);
  if (value.startsWith('2002:')) tail = value.split(':').slice(1, 3).join(':');
  if (!tail) return false;
  const words = tail.split(':');
  if (words.length !== 2) return false;
  const high = Number.parseInt(words[0]!, 16), low = Number.parseInt(words[1]!, 16);
  return !!isBlockedCloudMetadataHost(`${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`);
}

/** Connection retries are separate from, and do not change, HTTP status retries. */
export function createAgentPublicFetch(options: PublicFetchOptions = {}): typeof fetch {
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const signal = init.signal ?? (input instanceof Request ? input.signal : new AbortController().signal);
    const started = Date.now();
    for (let attempt = 1; ; attempt++) {
      try {
        options.onProgress?.({ stage: 'dns', delivery: 'not_sent', attempts: attempt, startedAt: started });
        if (signal.aborted) throw connectionError(signal.reason, 'dns', 'not_sent', signal);
        return await requestOnce(url, input, init, options, signal, attempt, started);
      } catch (error) {
        if (error instanceof LlmConnectionError) {
          error.diagnostic.attempts = attempt;
          error.diagnostic.elapsedMs = Date.now() - started;
        }
        if (signal.aborted || attempt >= 3 || !canRetryConnection(error)) throw error;
        options.onProgress?.({ stage: 'backoff', delivery: 'not_sent', attempts: attempt, startedAt: started });
        try { await delay(100 * 2 ** (attempt - 1), undefined, { signal }); }
        catch (abort) {
          const failure = connectionError(abort, 'backoff', 'not_sent', signal);
          failure.diagnostic.attempts = attempt;
          failure.diagnostic.elapsedMs = Date.now() - started;
          throw failure;
        }
      }
    }
  };
}

async function requestOnce(url: URL, input: Parameters<typeof fetch>[0], init: RequestInit,
  options: PublicFetchOptions, signal: AbortSignal, attempt: number, started: number): Promise<Response> {
  const addresses = await validatedAddresses(url, options, signal);
  if (signal.aborted) throw connectionError(signal.reason, 'dns', 'not_sent', signal);
  if (init.body !== undefined && init.body !== null && typeof init.body !== "string") throw new Error("Unsupported provider request body");
  if (typeof init.body === "string" && Buffer.byteLength(init.body) > MAX_RESPONSE_BYTES) throw new Error("Provider request too large");
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const headerValues: Record<string, string> = {};
  headers.forEach((value, key) => { headerValues[key] = value; });
  const pinnedLookup = ((_hostname: string, lookupOptions: { all?: boolean }, callback: (...args: unknown[]) => void) => {
    if (lookupOptions.all) callback(null, addresses);
    else callback(null, addresses[0]!.address, addresses[0]!.family);
  }) as LookupFunction;
  return new Promise<Response>((resolve, reject) => {
    let released = false, failed = false;
    let stage: ConnectionStage = 'tcp';
    const setStage = (next: ConnectionStage) => {
      if (failed) return;
      stage = next;
      options.onProgress?.({ stage, delivery: released ? 'possibly_sent' : 'not_sent', attempts: attempt, startedAt: started });
    };
    setStage('tcp');
    const failure = (error: unknown) => {
      const result = connectionError(error, stage, released ? 'possibly_sent' : 'not_sent', signal);
      result.diagnostic.attempts = attempt;
      result.diagnostic.elapsedMs = Date.now() - started;
      return result;
    };
    const request = options.requestImpl ?? (url.protocol === "https:" ? httpsRequest : httpRequest);
    const req = request(url, { method: init.method ?? "GET", headers: headerValues, agent: false, signal, lookup: pinnedLookup });
    req.once('error', error => { failed = true; reject(failure(error)); req.destroy(); });
    const send = () => {
      if (failed || released || req.destroyed) return;
      if (signal.aborted) { failed = true; reject(failure(signal.reason)); req.destroy(); return; }
      // Monotonic boundary: even synchronous end() failure is possibly sent.
      released = true; setStage('request');
      try { req.end(init.body ?? undefined); }
      catch (error) { failed = true; reject(failure(error)); req.destroy(); }
    };
    req.once('socket', socket => {
      if (url.protocol === 'https:') {
        socket.once('connect', () => { setStage('tls'); });
        socket.once('secureConnect', send);
      } else if (!socket.connecting) send();
      else socket.once('connect', send);
    });
    req.once('response', res => {
      if (failed) { res.destroy(); return; }
      setStage('response');
      const status = res.statusCode ?? 502;
      if (status < 200 || status > 599 || (status >= 300 && status < 400)) {
        res.destroy(); req.destroy(); reject(new AgentError("AGENT_HTTP_ERROR", "Provider redirects are unsupported")); return;
      }
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(res.headers)) if (value) responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
      if (status === 204 || status === 205) { res.destroy(); req.destroy(); resolve(new Response(null, { status, headers: responseHeaders })); return; }
      resolve(new Response(responseStream(res, req, failure), { status, headers: responseHeaders }));
    });
  });
}

function responseStream(res: IncomingMessage, req: ClientRequest, connectionFailure: (error: unknown) => LlmConnectionError): ReadableStream<Uint8Array> {
  let size = 0;
  let settled = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const fail = (error?: unknown) => {
        if (settled) return;
        settled = true;
        controller.error(error instanceof AgentError ? error : connectionFailure(error));
        res.destroy(); req.destroy();
      };
      res.on("data", (chunk: Buffer) => {
        if (settled) return;
        size += chunk.byteLength;
        if (size > MAX_RESPONSE_BYTES) { fail(new AgentError("AGENT_LLM_INVALID_RESPONSE", "Provider response too large")); return; }
        controller.enqueue(new Uint8Array(chunk));
        if ((controller.desiredSize ?? 0) <= 0) res.pause();
      });
      res.once("end", () => { if (!settled) { settled = true; controller.close(); } });
      res.once("error", fail);
      res.once("aborted", () => fail(Object.assign(new Error("Response aborted"), { code: "ECONNRESET" })));
    },
    pull() { res.resume(); },
    cancel() { settled = true; res.destroy(); req.destroy(); }
  }, { highWaterMark: 64 * 1024, size: chunk => chunk.byteLength });
}
