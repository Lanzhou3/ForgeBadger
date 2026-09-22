import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { assertResolvedPublicHttpsEndpoint } from '../network-policy.js';

const LIMIT = 1024 * 1024;
/** No redirects or ambient proxy/auth; actual TLS socket uses only validated DNS addresses. */
export async function publicFetch(input: string | URL | Request, init: RequestInit = {}, beforeSend?: () => void, options: { allowQuery?: boolean } = {}): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  let addresses: Awaited<ReturnType<typeof resolveAll>> = [];
  await assertResolvedPublicHttpsEndpoint(url.href, async hostname => {
    addresses = await resolveBounded(hostname); return addresses;
  });
  if (url.hash || (url.search && !options.allowQuery)) throw new Error('Endpoint query and fragment are unsupported');
  const method = init.method ?? (input instanceof Request ? input.method : 'GET');
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const body = init.body;
  if (body !== undefined && body !== null && typeof body !== 'string') throw new Error('Unsupported HTTP body');
  if (typeof body === 'string' && Buffer.byteLength(body) > LIMIT) throw new Error('Request too large');
  return new Promise<Response>((resolve, reject) => {
    beforeSend?.();
    const headerValues: Record<string, string> = {};
    headers.forEach((value,key) => { headerValues[key]=value; });
    const req = request(url, { method, headers: headerValues, agent: false,
      signal: init.signal ?? undefined,
      lookup: ((_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0]!.address, addresses[0]!.family);
      }) as import('node:net').LookupFunction
    });
    const timer = setTimeout(() => req.destroy(new Error('Remote request timed out')), 15_000);
    req.once('error', () => { clearTimeout(timer); reject(new Error('Remote request failed')); });
    req.once('response', res => {
      const status = res.statusCode ?? 502;
      if (status < 200 || status > 599 || (status >= 300 && status < 400)) { res.destroy(); clearTimeout(timer); reject(new Error('Redirects are unsupported')); return; }
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(res.headers)) if (value) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
      let size = 0;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > LIMIT) { res.destroy(new Error('Remote response too large')); return; }
            controller.enqueue(new Uint8Array(chunk));
          });
          res.once('end', () => { clearTimeout(timer); controller.close(); });
          res.once('error', () => { clearTimeout(timer); controller.error(new Error('Remote response interrupted')); });
        },
        cancel() { clearTimeout(timer); res.destroy(); req.destroy(); }
      });
      resolve(new Response([204, 205, 304].includes(status) ? null : stream, { status, headers: responseHeaders }));
    });
    req.end(body ?? undefined);
  });
}
function resolveAll(hostname: string) { return lookup(hostname, { all: true }); }

async function resolveBounded(hostname: string): Promise<Awaited<ReturnType<typeof resolveAll>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      resolveAll(hostname),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Remote DNS timed out')), 15_000); })
    ]);
  } finally { clearTimeout(timer); }
}
