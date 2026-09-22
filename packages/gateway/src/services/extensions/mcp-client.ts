import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ConnectionTool } from '../../db/repositories/copilot-connection-repository.js';
import { publicFetch } from './public-fetch.js';
import { remoteInputSchema } from './remote-schema.js';

export interface RemoteConnection { endpoint: string; bearerToken?: string; }
export interface McpClientOptions { fetch?: FetchLike; }
/** One bounded SDK session per operation. Never reconnect/replay a tools/call. */
async function withClient<T>(connection: RemoteConnection, options: McpClientOptions, action: (client: Client) => Promise<T>, preflight?: () => void): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let calls = 0;
  const transport = new StreamableHTTPClientTransport(new URL(connection.endpoint), {
    reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
    fetch: async (url, init = {}) => {
      if (new URL(url instanceof Request ? url.url : url.toString()).href !== connection.endpoint) throw new Error('MCP endpoint changed');
      if (init.method === 'GET') return new Response(null, { status: 405 });
      if (typeof init.body === 'string') {
        const message = JSON.parse(init.body) as { method?: string };
        if (message.method === 'tools/call') {
          if (++calls > 1) throw new Error('MCP call replay refused');
          preflight?.();
        }
      }
      preflight?.();
      const headers = new Headers(init.headers);
      if (connection.bearerToken) headers.set('Authorization', `Bearer ${connection.bearerToken}`);
      const requestInit: RequestInit = { ...init, headers, redirect: 'error', signal: AbortSignal.any([controller.signal, ...(init.signal ? [init.signal] : [])]) };
      return options.fetch ? options.fetch(url, requestInit) : publicFetch(url, requestInit, preflight);
    }
  });
  const client = new Client({ name: 'forgebadger-copilot', version: '1.0.0' }, { capabilities: {} });
  try { await client.connect(transport as import("@modelcontextprotocol/sdk/shared/transport.js").Transport, { timeout: 15_000 }); return await action(client); }
  finally { clearTimeout(timer); controller.abort(); await client.close().catch(() => undefined); }
}
export async function discoverMcpTools(connection: RemoteConnection, options: McpClientOptions = {}, preflight?: () => void): Promise<ConnectionTool[]> {
  return withClient(connection, options, async client => {
    const tools: ConnectionTool[] = [], names = new Set<string>(), cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : {}, { timeout: 10_000 });
      for (const tool of page.tools) {
        if (tools.length >= 100 || !tool.name || tool.name.length > 128 || names.has(tool.name)) throw new Error('Invalid or oversized MCP catalog');
        names.add(tool.name);
        let reason: string | null = null;
        try { remoteInputSchema(tool.inputSchema); } catch { reason = 'unsupported_input_schema'; }
        tools.push({ name: tool.name, description: (tool.description ?? tool.name).slice(0, 2000), inputSchema: tool.inputSchema, compatible: !reason, unavailableReason: reason });
      }
      cursor = page.nextCursor;
      if (cursor && (cursors.has(cursor) || cursors.size >= 20)) throw new Error('Invalid MCP pagination');
      if (cursor) cursors.add(cursor);
      if (JSON.stringify(tools).length > 256_000) throw new Error('MCP catalog too large');
    } while (cursor);
    return tools;
  }, preflight);
}
export async function callMcpTool(connection: RemoteConnection, name: string, args: Record<string, unknown>, preflight: () => void, options: McpClientOptions = {}): Promise<unknown> {
  return withClient(connection, options, async client => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 15_000 });
    if (result.isError) throw new Error('MCP reported failure; external effects may have occurred');
    return result;
  }, preflight);
}
