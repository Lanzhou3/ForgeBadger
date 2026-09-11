import { z } from 'zod';
import type { ManagementRequest, IoStreamRequest } from './ipc-protocol.js';

const text = z.string().min(1).max(4096);
const session = { sessionId: text };
const request = { id: text };
const client = { ...session, clientId: text };
const dimensions = { cols: z.number().int().min(1).max(500), rows: z.number().int().min(1).max(200) };
const launchPlan = z.object({
  command: text, args: z.array(z.string()), cwd: text,
  env: z.record(z.string(), z.string()), secretEnvNames: z.array(z.string()),
  credentialMode: z.enum(['stored_encrypted_key', 'host_environment'])
});
const schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create_session'), ...request, ...session, userId: z.string(), attachToken: z.string(), launchPlan }),
  ...(['kill_session', 'has_session', 'capture_pane', 'show_environment', 'inspect_pane', 'press_enter'] as const)
    .map(type => z.object({ type: z.literal(type), ...request, ...session })),
  ...(['list_sessions', 'shutdown_server'] as const).map(type => z.object({ type: z.literal(type), ...request })),
  ...(['send_input', 'stage_programmatic_input'] as const)
    .map(type => z.object({ type: z.literal(type), ...request, ...session, data: z.string() })),
  z.object({ type: z.literal('resize_window'), ...request, ...session, ...dimensions }),
  ...(['attach_client', 'detach_client'] as const).map(type => z.object({ type: z.literal(type), ...client })),
  z.object({ type: z.literal('client_input'), ...client, data: z.string() }),
  z.object({ type: z.literal('client_resize'), ...client, id: text.optional(), ...dimensions })
]);
export function parseIpcRequest(value: unknown): ManagementRequest | IoStreamRequest {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error('Invalid IPC request');
  if (result.data.type === 'client_resize') {
    const { id, ...message } = result.data;
    return id === undefined ? message : { ...message, id };
  }
  return result.data;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
