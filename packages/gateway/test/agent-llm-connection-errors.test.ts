import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { it } from 'node:test';
import { createAgentPublicFetch } from '../src/services/agent/llm-public-fetch.js';

const endpoint = 'https://api.example.com/chat/completions';
const resolveHost = async () => [{ address: '8.8.8.8', family: 4 }];
const nativeError = (code: string) => Object.assign(new Error('sensitive-provider-host Bearer private-credential'), { code });
interface Failure extends Error { code: string; diagnostic: { category: string; nativeCodes: string[]; delivery: string; stage: string; attempts: number; elapsedMs: number } }

/** External Node socket boundary, including the connect / secureConnect ordering. */
function socketTransport(code: string, phase: 'tcp' | 'tls' | 'sent' | 'response', recover = false) {
  let calls = 0, sends = 0;
  const requestImpl = (() => {
    const attempt = ++calls;
    const req = new EventEmitter() as ClientRequest;
    const socket = Object.assign(new EventEmitter(), { connecting: true });
    let dead = false;
    req.destroy = (() => { dead = true; return req; }) as ClientRequest['destroy'];
    req.end = (() => {
      sends++;
      queueMicrotask(() => {
        if (phase === 'sent' && !(recover && attempt > 1)) { req.emit('error', nativeError(code)); return; }
        const res = new Readable({ read() {} }) as IncomingMessage;
        res.statusCode = 200; res.headers = {};
        req.emit('response', res);
        if (phase === 'response') res.destroy(nativeError(code));
        else { res.push('ok'); res.push(null); }
      });
      return req;
    }) as ClientRequest['end'];
    queueMicrotask(() => {
      req.emit('socket', socket);
      if (phase === 'tcp' && !(recover && attempt > 1)) { req.emit('error', nativeError(code)); return; }
      socket.connecting = false; socket.emit('connect');
      if (phase === 'tls' && !(recover && attempt > 1)) { req.emit('error', nativeError(code)); return; }
      if (!dead) socket.emit('secureConnect');
    });
    return req;
  }) as typeof import('node:https').request;
  return { requestImpl, calls: () => calls, sends: () => sends };
}

for (const [native, expected, category, phase, attempts] of [
  ['ECONNREFUSED', 'AGENT_LLM_TCP_ERROR', 'tcp', 'tcp', 3],
  ['ECONNRESET', 'AGENT_LLM_TCP_ERROR', 'tcp', 'tcp', 3],
  ['CERT_HAS_EXPIRED', 'AGENT_LLM_TLS_ERROR', 'tls', 'tls', 1],
  ['ERR_TLS_CERT_ALTNAME_INVALID', 'AGENT_LLM_TLS_ERROR', 'tls', 'tls', 1],
  ['ETIMEDOUT', 'AGENT_LLM_TIMEOUT', 'timeout', 'tcp', 3],
] as const) {
  it(`classifies ${native} and bounds retries before sending`, async () => {
    const io = socketTransport(native, phase);
    await assert.rejects(createAgentPublicFetch({ resolveHost, requestImpl: io.requestImpl })(endpoint), error => {
      const failure = error as Failure;
      assert.equal(failure.code, expected);
      assert.equal(failure.diagnostic.category, category);
      assert.deepEqual(failure.diagnostic.nativeCodes, [native]);
      assert.equal(failure.diagnostic.delivery, 'not_sent');
      assert.equal(failure.diagnostic.attempts, attempts);
      assert.ok(failure.diagnostic.elapsedMs >= 0);
      assert.doesNotMatch(JSON.stringify(failure), /private-credential|sensitive-provider-host/);
      return true;
    });
    assert.equal(io.calls(), attempts); assert.equal(io.sends(), 0);
  });
}

it('retries temporary DNS failures but not missing domains; preserves DNS categories', async () => {
  for (const [code, attempts] of [['EAI_AGAIN', 3], ['ENOTFOUND', 1]] as const) {
    let lookups = 0;
    const io = socketTransport('ECONNRESET', 'sent');
    await assert.rejects(createAgentPublicFetch({ requestImpl: io.requestImpl, resolveHost: async () => { lookups++; throw nativeError(code); } })(endpoint), error => {
      const failure = error as Failure;
      assert.equal(failure.code, 'AGENT_LLM_DNS_ERROR');
      assert.deepEqual(failure.diagnostic.nativeCodes, [code]);
      assert.equal(failure.diagnostic.stage, 'dns');
      return true;
    });
    assert.equal(lookups, attempts); assert.equal(io.calls(), 0);
  }
});

it('recovers a confirmed unsent failure and sends the HTTP request exactly once', async () => {
  const io = socketTransport('ECONNRESET', 'tls', true);
  const response = await createAgentPublicFetch({ resolveHost, requestImpl: io.requestImpl })(endpoint, { method: 'POST', body: 'request' });
  assert.equal(await response.text(), 'ok');
  assert.equal(io.calls(), 2); assert.equal(io.sends(), 1);
});

it('never retries a connection failure after request release or after response headers', async () => {
  for (const phase of ['sent', 'response'] as const) {
    const io = socketTransport('ECONNRESET', phase);
    await assert.rejects(async () => {
      const response = await createAgentPublicFetch({ resolveHost, requestImpl: io.requestImpl })(endpoint);
      await response.text();
    }, error => {
      const failure = error as Failure;
      assert.equal(failure.code, 'AGENT_LLM_TCP_ERROR');
      assert.equal(failure.diagnostic.delivery, 'possibly_sent');
      return true;
    });
    assert.equal(io.calls(), 1); assert.equal(io.sends(), 1);
  }
});

it('cancellation during DNS and retry backoff stops before sending', async () => {
  for (const pendingDns of [true, false]) {
    const controller = new AbortController();
    let lookups = 0;
    const pending = createAgentPublicFetch({ resolveHost: async () => {
      lookups++;
      setTimeout(() => controller.abort(), 10);
      if (pendingDns) return new Promise<Awaited<ReturnType<typeof resolveHost>>>(() => {});
      throw nativeError('EAI_AGAIN');
    } })(endpoint, { signal: controller.signal });
    await assert.rejects(pending, { code: 'AGENT_LLM_CANCELLED' });
    assert.equal(lookups, 1);
  }
});

it('revalidates DNS on retry and blocks a private-address pivot without sending', async () => {
  let lookups = 0;
  const io = socketTransport('ECONNREFUSED', 'tcp');
  await assert.rejects(createAgentPublicFetch({ requestImpl: io.requestImpl, resolveHost: async () => [
    { address: ++lookups === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 },
  ] })(endpoint), { code: 'AGENT_HOST_BLOCKED' });
  assert.equal(io.calls(), 1); assert.equal(io.sends(), 0);
});

it('does not retry unknown native codes, even before sending', async () => {
  const io = socketTransport('PRIVATE_PROVIDER_SECRET', 'tcp');
  await assert.rejects(createAgentPublicFetch({ resolveHost, requestImpl: io.requestImpl })(endpoint), error => {
    const failure = error as Failure;
    assert.equal(failure.code, 'AGENT_LLM_CONNECTION_ERROR');
    assert.deepEqual(failure.diagnostic.nativeCodes, ['UNKNOWN']);
    return true;
  });
  assert.equal(io.calls(), 1); assert.equal(io.sends(), 0);
});

it('marks an end() synchronous throw as possibly sent and never retries', async () => {
  let calls = 0;
  const requestImpl = (() => {
    calls++;
    const req = new EventEmitter() as ClientRequest;
    req.destroy = (() => req) as ClientRequest['destroy'];
    req.end = (() => { throw nativeError('ECONNRESET'); }) as ClientRequest['end'];
    queueMicrotask(() => { const socket = new EventEmitter(); req.emit('socket', socket); socket.emit('secureConnect'); });
    return req;
  }) as typeof import('node:https').request;
  await assert.rejects(createAgentPublicFetch({ resolveHost, requestImpl })(endpoint), error => {
    assert.equal((error as Failure).diagnostic.delivery, 'possibly_sent'); return true;
  });
  assert.equal(calls, 1);
});

it('deadline and cancellation during TLS cannot release a late request', async () => {
  for (const timeout of [true, false]) {
    const controller = new AbortController();
    let calls = 0, sends = 0;
    const requestImpl = ((_url: URL, options: { signal: AbortSignal }) => {
      calls++;
      const req = new EventEmitter() as ClientRequest;
      const socket = new EventEmitter();
      req.destroy = (() => req) as ClientRequest['destroy'];
      req.end = (() => { sends++; return req; }) as ClientRequest['end'];
      options.signal.addEventListener('abort', () => {
        req.emit('error', nativeError('ABORT_ERR'));
        socket.emit('secureConnect');
      }, { once: true });
      queueMicrotask(() => {
        req.emit('socket', socket); socket.emit('connect');
        controller.abort(new DOMException('stop', timeout ? 'TimeoutError' : 'AbortError'));
      });
      return req;
    }) as typeof import('node:https').request;
    await assert.rejects(createAgentPublicFetch({ resolveHost, requestImpl })(endpoint, { signal: controller.signal }), error => {
      const failure = error as Failure;
      assert.equal(failure.code, timeout ? 'AGENT_LLM_TIMEOUT' : 'AGENT_LLM_CANCELLED');
      assert.equal(failure.diagnostic.stage, 'tls');
      assert.equal(failure.diagnostic.delivery, 'not_sent'); return true;
    });
    assert.equal(calls, 1); assert.equal(sends, 0);
  }
});

it('pins trusted private host DNS and still rejects cloud metadata', async () => {
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    assert.equal(req.method, 'POST');
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => { assert.equal(body, 'exactly once'); res.end('ok'); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    let lookups = 0;
    const transport = createAgentPublicFetch({ allowPlaintextHttp: true, allowPrivateNetworks: true,
      resolveHost: async () => { lookups++; return [{ address: '127.0.0.1', family: 4 }]; } });
    for (const hostname of ['local-model.example', '127.0.0.1']) {
      const response = await transport(`http://${hostname}:${address.port}/chat`, { method: 'POST', body: 'exactly once', signal: AbortSignal.timeout(2000) });
      assert.equal(await response.text(), 'ok');
    }
    assert.equal(lookups, 1);
    await assert.rejects(transport('http://169.254.169.254/chat'), { code: 'AGENT_HOST_BLOCKED' });
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

it('classifies safe AggregateError codes without persisting child messages', async () => {
  const requestImpl = (() => {
    const req = new EventEmitter() as ClientRequest;
    req.destroy = (() => req) as ClientRequest['destroy'];
    queueMicrotask(() => req.emit('error', new AggregateError([
      nativeError('ECONNREFUSED'), nativeError('CERT_HAS_EXPIRED'),
    ], 'private aggregate')));
    return req;
  }) as typeof import('node:https').request;
  await assert.rejects(createAgentPublicFetch({ resolveHost, requestImpl })(endpoint), error => {
    const failure = error as Failure;
    assert.equal(failure.code, 'AGENT_LLM_TLS_ERROR');
    assert.deepEqual(failure.diagnostic.nativeCodes, ['ECONNREFUSED', 'CERT_HAS_EXPIRED']);
    assert.equal(failure.diagnostic.attempts, 1);
    assert.doesNotMatch(JSON.stringify(failure), /private/); return true;
  });
});

it('keeps HTTP status retry semantics separate from unsent connection retry attempts', async () => {
  const { fetchModelWithRetry } = await import('../src/services/agent/model-transport.js');
  let calls = 0, sends = 0;
  const requestImpl = (() => {
    const attempt = ++calls;
    const req = new EventEmitter() as ClientRequest;
    req.destroy = (() => req) as ClientRequest['destroy'];
    req.end = (() => {
      sends++;
      queueMicrotask(() => {
        const res = Readable.from([Buffer.from('ok')]) as IncomingMessage;
        res.statusCode = sends === 1 ? 503 : 200; res.headers = { 'retry-after': '0' };
        req.emit('response', res);
      }); return req;
    }) as ClientRequest['end'];
    queueMicrotask(() => {
      if (attempt === 1 || attempt === 3) { req.emit('error', nativeError('ECONNREFUSED')); return; }
      const socket = new EventEmitter(); req.emit('socket', socket); socket.emit('secureConnect');
    }); return req;
  }) as typeof import('node:https').request;
  const response = await fetchModelWithRetry(createAgentPublicFetch({ resolveHost, requestImpl }), endpoint, { method: 'POST', body: 'same' });
  assert.equal(await response.text(), 'ok');
  assert.equal(calls, 4); assert.equal(sends, 2);
});

it('cancellation while reading a response keeps the sent state and never reconnects', async () => {
  const controller = new AbortController();
  let calls = 0;
  const requestImpl = (() => {
    calls++;
    const req = new EventEmitter() as ClientRequest;
    req.destroy = (() => req) as ClientRequest['destroy'];
    req.end = (() => {
      queueMicrotask(() => {
        const res = new Readable({ read() {} }) as IncomingMessage;
        res.statusCode = 200; res.headers = {};
        req.emit('response', res);
        controller.abort(); res.destroy(nativeError('ABORT_ERR'));
      }); return req;
    }) as ClientRequest['end'];
    queueMicrotask(() => { const socket = new EventEmitter(); req.emit('socket', socket); socket.emit('secureConnect'); });
    return req;
  }) as typeof import('node:https').request;
  const response = await createAgentPublicFetch({ resolveHost, requestImpl })(endpoint, { signal: controller.signal });
  await assert.rejects(response.text(), error => {
    const failure = error as Failure;
    assert.equal(failure.code, 'AGENT_LLM_CANCELLED');
    assert.equal(failure.diagnostic.delivery, 'possibly_sent'); return true;
  });
  assert.equal(calls, 1);
});


it('blocks DNS answers pointing at metadata even for trusted private providers', async () => {
  for (const address of ['169.254.169.254', '100.100.100.200', '::ffff:169.254.169.254', '0:0:0:0:0:ffff:a9fe:a9fe', '64:ff9b::a9fe:a9fe', 'fd00:ec2::254']) {
    const io = socketTransport('ECONNRESET', 'sent');
    await assert.rejects(createAgentPublicFetch({ requestImpl: io.requestImpl, allowPrivateNetworks: true,
      resolveHost: async () => [{ address, family: address.includes(':') ? 6 : 4 }],
    })(endpoint), { code: 'AGENT_HOST_BLOCKED' });
    assert.equal(io.calls(), 0);
  }
});
