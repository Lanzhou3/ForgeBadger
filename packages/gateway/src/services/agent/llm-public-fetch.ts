import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest, type IncomingMessage, type ClientRequest } from "node:http";
import type { LookupFunction } from "node:net";
import { assertResolvedPublicHttpsEndpoint, type OutboundHostResolver } from "../network-policy.js";
import { AgentError } from "./types.js";
import { MAX_RESPONSE_BYTES, withAbort } from "./llm-response.js";

interface PublicFetchOptions {
  resolveHost?: OutboundHostResolver;
  allowPlaintextHttp?: boolean;
  /** External socket boundary for tests; production selects Node HTTP(S) by protocol. */
  requestImpl?: typeof httpsRequest;
}

async function validatedAddresses(url: URL, options: PublicFetchOptions, signal: AbortSignal) {
  let addresses: Awaited<ReturnType<OutboundHostResolver>> = [];
  try {
    await withAbort(assertResolvedPublicHttpsEndpoint(url.href, async (hostname, lookupOptions) => {
      addresses = options.resolveHost ? await options.resolveHost(hostname, lookupOptions) : await lookup(hostname, { all: true });
      return addresses;
    }, { allowPlaintextHttp: options.allowPlaintextHttp }), signal);
    if (url.hash || url.search) throw new Error("Ambiguous provider endpoint");
    return addresses;
  } catch (error) {
    if (signal.aborted) throw error;
    throw new AgentError("AGENT_HOST_BLOCKED", "Provider endpoint failed public-network validation");
  }
}

/** Pins DNS to the validated addresses and refuses redirects; the caller owns the full request deadline. */
export function createAgentPublicFetch(options: PublicFetchOptions = {}): typeof fetch {
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const signal = init.signal ?? (input instanceof Request ? input.signal : new AbortController().signal);
    const addresses = await validatedAddresses(url, options, signal);
    signal.throwIfAborted();
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
      const request = options.requestImpl ?? (url.protocol === "https:" ? httpsRequest : httpRequest);
      const req = request(url, { method: init.method ?? "GET", headers: headerValues, agent: false, signal, lookup: pinnedLookup });
      req.once("error", () => reject(new AgentError("AGENT_LLM_FAILED", "Provider connection failed")));
      req.once("response", res => {
        const status = res.statusCode ?? 502;
        if (status < 200 || status > 599 || (status >= 300 && status < 400)) {
          res.destroy(); req.destroy(); reject(new AgentError("AGENT_HTTP_ERROR", "Provider redirects are unsupported")); return;
        }
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) if (value) responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
        if (status === 204 || status === 205) { res.destroy(); req.destroy(); resolve(new Response(null, { status, headers: responseHeaders })); return; }
        resolve(new Response(responseStream(res, req), { status, headers: responseHeaders }));
      });
      req.end(init.body ?? undefined);
    });
  };
}

function responseStream(res: IncomingMessage, req: ClientRequest): ReadableStream<Uint8Array> {
  let size = 0;
  let settled = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const fail = () => {
        if (settled) return;
        settled = true;
        controller.error(new AgentError("AGENT_LLM_INVALID_RESPONSE", "Provider response interrupted or too large"));
        res.destroy(); req.destroy();
      };
      res.on("data", (chunk: Buffer) => {
        if (settled) return;
        size += chunk.byteLength;
        if (size > MAX_RESPONSE_BYTES) { fail(); return; }
        controller.enqueue(new Uint8Array(chunk));
        if ((controller.desiredSize ?? 0) <= 0) res.pause();
      });
      res.once("end", () => { if (!settled) { settled = true; controller.close(); } });
      res.once("error", fail);
      res.once("aborted", fail);
    },
    pull() { res.resume(); },
    cancel() { settled = true; res.destroy(); req.destroy(); }
  }, { highWaterMark: 64 * 1024, size: chunk => chunk.byteLength });
}
