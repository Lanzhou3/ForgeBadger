import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { WebSocket, WebSocketServer } from 'ws';
import { verifyCompanionSignature } from './crypto.js';

const version = z.literal(1);
const hostId = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().uuid();
const key = z.string().regex(/^[A-Za-z0-9_-]+$/).max(128);
const sealed = z.object({
  senderEncryptionPublicKey: z.string().max(128),
  nonce: z.string().max(64),
  ciphertext: z.string().max(50_000),
  authTag: z.string().max(64)
}).strict();
const hostRegistration = z.object({
  type: z.literal('host.register'), protocolVersion: version, hostId,
  signingPublicKey: key, encryptionPublicKey: key,
  nonce: z.string().min(20).max(64), timestamp: z.number().int().positive(),
  signature: z.string().max(128)
}).strict();
const deviceRegistration = z.object({
  type: z.literal('device.register'), protocolVersion: version, hostId, pairingId: uuid, deviceId: uuid,
  signingPublicKey: key, encryptionPublicKey: key, registeredAt: z.number().int().positive(), signature: z.string().max(128)
}).strict();
const deviceConnection = z.object({
  type: z.literal('device.connect'), protocolVersion: version, hostId, deviceId: uuid,
  nonce: z.string().min(20).max(64), timestamp: z.number().int().positive(), signature: z.string().max(128)
}).strict();
const pairingClaim = z.object({
  type: z.literal('pairing.claim'), protocolVersion: version, hostId, pairingId: uuid, sealed
}).strict();
const pairingFailure = z.object({
  type: z.literal('pairing.claim.failed'), hostId, pairingId: uuid,
  code: z.string().regex(/^[A-Z0-9_]+$/).max(80)
}).strict();
const pairingClaimed = z.object({
  type: z.literal('pairing.claimed'), hostId, pairingId: uuid, sealed
}).strict();
const envelope = z.object({
  type: z.literal('envelope'), hostId, deviceId: uuid, messageId: uuid,
  kind: z.enum(['query', 'query_result', 'event', 'error', 'command', 'command_receipt']), sealed
}).strict();

interface HostRoute {
  socket: WebSocket;
  signingPublicKey: string;
  lastSeen: number;
}
interface DeviceRoute {
  signingPublicKey: string;
  encryptionPublicKey: string;
}
interface Peer {
  role: 'host' | 'device' | 'pending' | 'unidentified';
  hostId?: string;
  deviceId?: string;
  pairingId?: string;
  messages: number;
  windowStarted: number;
}

export interface CompanionRelay {
  port: number;
  close(): Promise<void>;
}

export async function createCompanionRelayServer(options: {
  host: string;
  port: number;
  now?: () => number;
}): Promise<CompanionRelay> {
  const now = options.now ?? Date.now;
  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 0, data: { status: 'ok' }, message: '' }));
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ server: http, path: '/companion/v1', maxPayload: 64 * 1024 });
  const hosts = new Map<string, HostRoute>();
  const devices = new Map<string, DeviceRoute>();
  const pending = new Map<string, WebSocket>();
  const deviceSockets = new Map<string, Set<WebSocket>>();
  const nonces = new Map<string, number>();
  const peers = new Map<WebSocket, Peer>();

  const send = (socket: WebSocket, value: unknown) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
  };
  const fail = (socket: WebSocket, code: string) => send(socket, {
    type: 'error', messageId: randomUUID(), code
  });
  const online = (hostId: string) => {
    const route = hosts.get(hostId);
    return route !== undefined && route.socket.readyState === WebSocket.OPEN && route.lastSeen > now() - 45_000;
  };
  const deviceKey = (hostId: string, deviceId: string) => `${hostId}:${deviceId}`;

  wss.on('connection', socket => {
    if (peers.size >= 1000 || pending.size >= 100) {
      socket.close(1013, 'Relay capacity reached');
      return;
    }
    const peer: Peer = { role: 'unidentified', messages: 0, windowStarted: now() };
    peers.set(socket, peer);
    socket.on('message', raw => {
      if (!peers.has(socket)) return;
      if (!allowMessage(peer, now())) {
        fail(socket, 'COMPANION_RATE_LIMITED');
        return;
      }
      let input: unknown;
      try { input = JSON.parse(raw.toString()); } catch {
        fail(socket, 'COMPANION_MESSAGE_INVALID');
        return;
      }
      try {
        routeMessage(input as Record<string, unknown>);
      } catch {
        fail(socket, 'COMPANION_MESSAGE_INVALID');
      }
    });
    socket.on('close', () => {
      const peer = peers.get(socket);
      if (peer?.role === 'host' && peer.hostId && hosts.get(peer.hostId)?.socket === socket) {
        hosts.delete(peer.hostId);
      }
      if (peer?.pairingId && pending.get(peer.pairingId) === socket) pending.delete(peer.pairingId);
      if (peer?.role === 'device' && peer.hostId && peer.deviceId) {
        const sockets = deviceSockets.get(deviceKey(peer.hostId, peer.deviceId));
        sockets?.delete(socket);
      }
      peers.delete(socket);
    });

    function routeMessage(input: Record<string, unknown>): void {
      if (input.type === 'host.register') {
        const message = hostRegistration.parse(input);
        const { signature, ...signed } = message;
        if (createHash('sha256').update(Buffer.from(message.signingPublicKey, 'base64url')).digest('hex') !== message.hostId
          || Math.abs(now() - message.timestamp) > 300_000 || !freshNonce(`host:${message.hostId}:${message.nonce}`)
          || !verifyCompanionSignature(signed, message.signingPublicKey, signature)) {
          fail(socket, 'COMPANION_AUTH_FAILED');
          return;
        }
        hosts.get(message.hostId)?.socket.close(4000, 'Host connection replaced');
        hosts.set(message.hostId, { socket, signingPublicKey: message.signingPublicKey, lastSeen: now() });
        Object.assign(peer, { role: 'host', hostId: message.hostId });
        send(socket, { type: 'host.ready', hostId: message.hostId });
        return;
      }
      if (input.type === 'host.heartbeat') {
        if (peer.role !== 'host' || !peer.hostId) return fail(socket, 'COMPANION_AUTH_FAILED');
        const route = hosts.get(peer.hostId);
        if (route) route.lastSeen = now();
        send(socket, { type: 'host.heartbeat.ack', timestamp: now() });
        return;
      }
      if (input.type === 'pairing.claim') {
        const message = pairingClaim.parse(input);
        if (!online(message.hostId) || pending.has(message.pairingId)) return fail(socket, 'COMPANION_HOST_OFFLINE');
        Object.assign(peer, { role: 'pending', hostId: message.hostId, pairingId: message.pairingId });
        pending.set(message.pairingId, socket);
        send(hosts.get(message.hostId)!.socket, message);
        return;
      }
      if (input.type === 'pairing.claimed') {
        const message = pairingClaimed.parse(input);
        if (peer.role !== 'host' || peer.hostId !== message.hostId) return fail(socket, 'COMPANION_AUTH_FAILED');
        const pendingSocket = pending.get(message.pairingId);
        if (pendingSocket) send(pendingSocket, message);
        return;
      }
      if (input.type === 'pairing.claim.failed') {
        const message = pairingFailure.parse(input);
        if (peer.role !== 'host' || peer.hostId !== message.hostId) return fail(socket, 'COMPANION_AUTH_FAILED');
        const pendingSocket = pending.get(message.pairingId);
        if (pendingSocket) send(pendingSocket, message);
        return;
      }
      if (input.type === 'device.register') {
        const message = deviceRegistration.parse(input);
        if (peer.role !== 'host' || peer.hostId !== message.hostId) return fail(socket, 'COMPANION_AUTH_FAILED');
        const { signature, ...signed } = message;
        const host = hosts.get(message.hostId);
        if (!host || !verifyCompanionSignature(signed, host.signingPublicKey, signature)) {
          return fail(socket, 'COMPANION_AUTH_FAILED');
        }
        const id = deviceKey(message.hostId, message.deviceId);
        const existing = devices.get(id);
        if (existing && (existing.signingPublicKey !== message.signingPublicKey
          || existing.encryptionPublicKey !== message.encryptionPublicKey)) {
          return fail(socket, 'COMPANION_DEVICE_KEY_INVALID');
        }
        devices.set(id, { signingPublicKey: message.signingPublicKey, encryptionPublicKey: message.encryptionPublicKey });
        const pendingSocket = pending.get(message.pairingId);
        if (pendingSocket) {
          const pendingPeer = peers.get(pendingSocket);
          if (pendingPeer?.hostId === message.hostId) {
            Object.assign(pendingPeer, { role: 'device', deviceId: message.deviceId, pairingId: undefined });
            trackDeviceSocket(message.hostId, message.deviceId, pendingSocket);
            send(pendingSocket, { type: 'device.ready', hostId: message.hostId, deviceId: message.deviceId });
          }
          pending.delete(message.pairingId);
        }
        return;
      }
      if (input.type === 'device.connect') {
        const message = deviceConnection.parse(input);
        const route = devices.get(deviceKey(message.hostId, message.deviceId));
        const { signature, ...signed } = message;
        if (!route || Math.abs(now() - message.timestamp) > 300_000
          || !freshNonce(`device:${message.deviceId}:${message.nonce}`)
          || !verifyCompanionSignature(signed, route.signingPublicKey, signature)) {
          return fail(socket, 'COMPANION_DEVICE_AUTH_FAILED');
        }
        Object.assign(peer, { role: 'device', hostId: message.hostId, deviceId: message.deviceId });
        trackDeviceSocket(message.hostId, message.deviceId, socket);
        send(socket, { type: 'device.ready', hostId: message.hostId, deviceId: message.deviceId });
        return;
      }
      if (input.type === 'envelope') {
        const message = envelope.parse(input);
        if (peer.role === 'device' && peer.hostId === message.hostId && peer.deviceId === message.deviceId) {
          if (!online(message.hostId)) return fail(socket, 'COMPANION_HOST_OFFLINE');
          send(hosts.get(message.hostId)!.socket, message);
          return;
        }
        if (peer.role === 'host' && peer.hostId === message.hostId) {
          const targets = deviceSockets.get(deviceKey(message.hostId, message.deviceId));
          if (!targets || targets.size === 0) return fail(socket, 'COMPANION_DEVICE_OFFLINE');
          for (const target of targets) send(target, message);
          return;
        }
        return fail(socket, 'COMPANION_AUTH_FAILED');
      }
      if (input.type === 'presence.get') {
        if (peer.role !== 'device' || !peer.hostId) return fail(socket, 'COMPANION_AUTH_FAILED');
        const route = hosts.get(peer.hostId);
        send(socket, {
          type: 'presence', hostId: peer.hostId, online: online(peer.hostId),
          lastSeenAt: route?.lastSeen ?? null, generatedAt: now()
        });
        return;
      }
      fail(socket, 'COMPANION_METHOD_NOT_ALLOWED');
    }
  });

  function trackDeviceSocket(hostId: string, deviceId: string, socket: WebSocket): void {
    const id = deviceKey(hostId, deviceId);
    const sockets = deviceSockets.get(id) ?? new Set<WebSocket>();
    sockets.add(socket);
    deviceSockets.set(id, sockets);
  }
  function freshNonce(id: string): boolean {
    if (nonces.has(id)) return false;
    nonces.set(id, now());
    if (nonces.size > 10_000) {
      for (const [key, createdAt] of nonces) {
        if (createdAt < now() - 600_000) nonces.delete(key);
      }
      if (nonces.size > 10_000) nonces.delete(nonces.keys().next().value!);
    }
    return true;
  }

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port, options.host, () => resolve());
  });
  const port = (http.address() as AddressInfo).port;
  return {
    port,
    async close() {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>(resolve => wss.close(() => resolve()));
      await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
    }
  };
}

function allowMessage(peer: Peer, now: number): boolean {
  if (now - peer.windowStarted > 10_000) {
    peer.windowStarted = now;
    peer.messages = 0;
  }
  peer.messages += 1;
  return peer.messages <= 100;
}
