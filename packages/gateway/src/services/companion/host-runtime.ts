import { lookup } from 'node:dns/promises';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { Database } from '../../db/types.js';
import { CompanionDeviceRepository, CompanionHostRepository } from '../../db/repositories/companion-repository.js';
import { validateOutboundHost } from '../network-policy.js';
import { CompanionService } from './companion-service.js';
import { CompanionCommandService } from './command-service.js';
import type { AgentStackDeps } from '../agent/agent-stack.js';
import {
  openCompanionMessage,
  sealCompanionMessage,
  signCompanionPayload,
  type CompanionSealedMessage
} from './transport-crypto.js';

interface HostRuntimeOptions {
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  allowPrivateNetworks?: boolean;
  relayUrlTransform?: (url: string) => string;
}

interface DeviceQuery {
  type: 'snapshot' | 'sync';
  authorityRevision: number;
  afterSequence?: number;
}

export class CompanionHostRuntime {
  private readonly service: CompanionService;
  private readonly commandService: CompanionCommandService | undefined;
  private readonly hostRecords: CompanionHostRepository;
  private readonly pollIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private running = false;
  private ticking = false;
  private timer: NodeJS.Timeout | undefined;
  private heartbeat: NodeJS.Timeout | undefined;
  private socket: WebSocket | undefined;
  private ready = false;
  private connecting: Promise<void> | undefined;
  private configurationKey?: string;
  private lastHeartbeat = 0;
  private readonly cursors = new Map<string, number>();

  constructor(
    private readonly db: Database,
    masterKey: string,
    featureEnabled: boolean,
    private readonly options: HostRuntimeOptions = {},
    agentDeps?: AgentStackDeps
  ) {
    this.service = new CompanionService(db, masterKey, featureEnabled);
    this.commandService = agentDeps ? new CompanionCommandService(db, masterKey, agentDeps) : undefined;
    this.hostRecords = new CompanionHostRepository(db);
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.commandService?.recoverCommands();
    await this.tick();
    this.timer = setInterval(() => { void this.tick(); }, this.pollIntervalMs);
    this.timer.unref();
    this.heartbeat = setInterval(() => this.sendHeartbeat(), this.heartbeatIntervalMs);
    this.heartbeat.unref();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.timer = undefined;
    this.heartbeat = undefined;
    this.disconnect();
  }

  private async tick(): Promise<void> {
    if (!this.running || this.ticking) return;
    this.ticking = true;
    try {
      const status = this.service.getHostStatus();
      if (!status.featureEnabled || !status.host?.enabled) {
        this.disconnect();
        return;
      }
      const configurationKey = `${status.host.relayUrl}:${status.host.revision}`;
      if (configurationKey !== this.configurationKey) {
        this.disconnect();
        this.configurationKey = configurationKey;
        this.cursors.clear();
      }
      await this.ensureConnected(status.host.relayUrl);
      this.flushOutbox();
    } catch {
      this.disconnect();
    } finally {
      this.ticking = false;
    }
  }

  private async ensureConnected(relayUrl: string): Promise<void> {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return this.connecting;
    }
    const transformed = this.options.relayUrlTransform?.(relayUrl) ?? relayUrl;
    const url = new URL(transformed);
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') throw new Error('COMPANION_RELAY_URL_INVALID');
    const rejection = await validateOutboundHost(url.hostname, lookup, {
      allowPrivateNetworks: this.options.allowPrivateNetworks === true
    });
    if (rejection) throw new Error('COMPANION_RELAY_HOST_REJECTED');
    this.connecting = this.openSocket(url.toString());
    return this.connecting;
  }

  private openSocket(url: string): Promise<void> {
    const host = this.service.getHostStatus().host;
    if (!host) throw new Error('COMPANION_HOST_NOT_CONFIGURED');
    const privateKeys = this.service.loadHostPrivateKeys();
    const socket = new WebSocket(url);
    this.socket = socket;
    this.ready = false;
    const opened = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('COMPANION_RELAY_TIMEOUT')), 5000);
      socket.on('open', () => {
        const registration = {
          type: 'host.register',
          protocolVersion: 1,
          hostId: host.hostId,
          signingPublicKey: host.signingPublicKey,
          encryptionPublicKey: host.encryptionPublicKey,
          nonce: randomUUID(),
          timestamp: Date.now()
        };
        socket.send(JSON.stringify({
          ...registration,
          signature: signCompanionPayload(registration, privateKeys.signingPrivateKey)
        }));
      });
      socket.on('message', raw => {
        try {
          const message = JSON.parse(raw.toString()) as Record<string, unknown>;
          if (message.type === 'host.ready') {
            this.ready = true;
            clearTimeout(timeout);
            resolve();
            this.flushOutbox();
            return;
          }
          void this.handleMessage(message, privateKeys.signingPrivateKey, privateKeys.encryptionPrivateKey);
        } catch {
          // Malformed Relay frames are ignored without exposing payload data.
        }
      });
      socket.on('error', () => {
        clearTimeout(timeout);
        reject(new Error('COMPANION_RELAY_UNAVAILABLE'));
      });
      socket.on('close', () => {
        clearTimeout(timeout);
        if (this.socket === socket) {
          this.socket = undefined;
          this.ready = false;
          this.connecting = undefined;
          this.cursors.clear();
        }
        reject(new Error('COMPANION_RELAY_CLOSED'));
      });
    });
    return opened;
  }

  private async handleMessage(message: Record<string, unknown>, signingPrivateKey: string, encryptionPrivateKey: string): Promise<void> {
    if (message.type === 'pairing.claim') {
      const hostId = requiredString(message.hostId);
      const pairingId = requiredString(message.pairingId);
      try {
        const opened = openCompanionMessage<{ signingPublicKey: string }>({
          sealed: message.sealed as CompanionSealedMessage,
          encryptionPrivateKey,
          context: `pairing.claim:${hostId}:${pairingId}`
        });
        const claim = opened.payload as Record<string, unknown>;
        if (claim.signingPublicKey !== opened.signingPublicKey) throw new Error('COMPANION_DEVICE_KEY_INVALID');
        const claimed = this.service.claimPairing(claim);
        this.sendRaw({
          type: 'pairing.claimed',
          hostId,
          pairingId,
          sealed: sealCompanionMessage({
            payload: { sas: claimed.sas },
            signingPrivateKey,
            encryptionPrivateKey,
            recipientEncryptionPublicKey: requiredString(claim.encryptionPublicKey),
            context: `pairing.claimed:${hostId}:${pairingId}`
          })
        });
      } catch (error) {
        this.sendRaw({
          type: 'pairing.claim.failed',
          hostId,
          pairingId,
          code: stableCode(error)
        });
      }
      return;
    }
    if (message.type !== 'envelope') return;
    const hostId = requiredString(message.hostId);
    const deviceId = requiredString(message.deviceId);
    const messageId = requiredString(message.messageId);
    if (message.kind === 'command') {
      await this.handleCommand({ hostId, deviceId, messageId, message, signingPrivateKey, encryptionPrivateKey });
      return;
    }
    if (message.kind !== 'query') return;
    const ownerId = this.hostRecords.deviceOwner(deviceId);
    const device = ownerId ? new CompanionDeviceRepository(this.db, ownerId).device(deviceId) : undefined;
    if (!device || device.hostId !== hostId) return;
    try {
      const opened = openCompanionMessage<DeviceQuery>({
        sealed: message.sealed as CompanionSealedMessage,
        encryptionPrivateKey,
        context: `query:${hostId}:${deviceId}:${messageId}`,
        expectedSigningPublicKey: device.signingPublicKey
      });
      if (opened.payload.type !== 'snapshot' && opened.payload.type !== 'sync') {
        throw new Error('COMPANION_METHOD_NOT_ALLOWED');
      }
      const payload = opened.payload.type === 'snapshot'
        ? { ok: true, snapshot: this.service.getDeviceSnapshot(deviceId, opened.payload.authorityRevision) }
        : { ok: true, sync: this.service.syncDeviceEvents(deviceId, opened.payload.authorityRevision, opened.payload.afterSequence ?? 0) };
      this.sendEnvelope({
        hostId,
        deviceId,
        messageId,
        kind: 'query_result',
        payload,
        recipientEncryptionPublicKey: device.encryptionPublicKey,
        signingPrivateKey
      });
    } catch (error) {
      this.sendEnvelope({
        hostId,
        deviceId,
        messageId,
        kind: 'query_result',
        payload: { ok: false, code: stableCode(error) },
        recipientEncryptionPublicKey: device.encryptionPublicKey,
        signingPrivateKey
      });
    }
  }

  private async handleCommand(input: {
    hostId: string;
    deviceId: string;
    messageId: string;
    message: Record<string, unknown>;
    signingPrivateKey: string;
    encryptionPrivateKey: string;
  }): Promise<void> {
    const { hostId, deviceId, messageId, message, signingPrivateKey, encryptionPrivateKey } = input;
    const ownerId = this.hostRecords.deviceOwner(deviceId);
    const device = ownerId ? new CompanionDeviceRepository(this.db, ownerId).device(deviceId) : undefined;
    if (!device || device.hostId !== hostId) return;
    let receipt: Record<string, unknown>;
    try {
      if (!this.commandService) throw new Error('COMPANION_METHOD_NOT_ALLOWED');
      const opened = openCompanionMessage<Record<string, unknown>>({
        sealed: message.sealed as CompanionSealedMessage,
        encryptionPrivateKey,
        context: `command:${hostId}:${deviceId}:${messageId}`,
        expectedSigningPublicKey: device.signingPublicKey
      });
      const command = await this.commandService.execute({ ...opened.payload, hostId, deviceId, commandId: messageId });
      receipt = {
        protocolVersion: 1,
        status: command.status,
        effectStatus: command.effectStatus,
        authorityRevision: command.authorityRevision,
        resultReference: command.resultReference,
        errorCode: command.errorCode,
        createdAt: command.createdAt,
        updatedAt: command.updatedAt
      };
    } catch (error) {
      receipt = {
        protocolVersion: 1,
        status: 'rejected',
        effectStatus: 'none',
        authorityRevision: device.authorityRevision,
        resultReference: null,
        errorCode: stableCode(error),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    }
    this.sendEnvelope({
      hostId,
      deviceId,
      messageId,
      kind: 'command_receipt',
      payload: receipt,
      recipientEncryptionPublicKey: device.encryptionPublicKey,
      signingPrivateKey
    });
  }

  private flushOutbox(): void {
    if (!this.ready) return;
    const host = this.service.getHostStatus().host;
    if (!host) return;
    const privateKeys = this.service.loadHostPrivateKeys();
    for (const event of this.service.listHostOutbox(0)) {
      if (event.sequence <= (this.cursors.get(event.deviceId) ?? 0)) continue;
      if (event.type === 'device.confirmed') {
        const pairingId = requiredString(event.payload.pairingId);
        const device = event.payload.device as Record<string, unknown>;
        const registration = {
          type: 'device.register',
          protocolVersion: 1,
          hostId: host.hostId,
          pairingId,
          deviceId: event.deviceId,
          signingPublicKey: requiredString(device.signingPublicKey),
          encryptionPublicKey: requiredString(device.encryptionPublicKey),
          registeredAt: Date.now()
        };
        this.sendRaw({ ...registration, signature: signCompanionPayload(registration, privateKeys.signingPrivateKey) });
      }
      const records = new CompanionDeviceRepository(this.db, event.userId);
      const device = records.device(event.deviceId);
      if (!device) {
        this.cursors.set(event.deviceId, event.sequence);
        continue;
      }
      this.sendEnvelope({
        hostId: host.hostId,
        deviceId: event.deviceId,
        messageId: event.id,
        kind: 'event',
        payload: {
          type: event.type,
          sequence: event.sequence,
          createdAt: event.createdAt,
          ...event.payload
        },
        recipientEncryptionPublicKey: device.encryptionPublicKey,
        signingPrivateKey: privateKeys.signingPrivateKey
      });
      this.cursors.set(event.deviceId, event.sequence);
    }
  }

  private sendEnvelope(input: {
    hostId: string;
    deviceId: string;
    messageId: string;
    kind: 'query_result' | 'event' | 'command_receipt';
    payload: unknown;
    recipientEncryptionPublicKey: string;
    signingPrivateKey: string;
  }): void {
    const privateKeys = this.service.loadHostPrivateKeys();
    const sealed = sealCompanionMessage({
      payload: input.payload,
      signingPrivateKey: input.signingPrivateKey,
      encryptionPrivateKey: privateKeys.encryptionPrivateKey,
      recipientEncryptionPublicKey: input.recipientEncryptionPublicKey,
      context: `${input.kind}:${input.hostId}:${input.deviceId}:${input.messageId}`
    });
    this.sendRaw({
      type: 'envelope',
      hostId: input.hostId,
      deviceId: input.deviceId,
      messageId: input.messageId,
      kind: input.kind,
      sealed
    });
  }

  private sendHeartbeat(): void {
    if (!this.ready || Date.now() - this.lastHeartbeat < this.heartbeatIntervalMs) return;
    this.lastHeartbeat = Date.now();
    this.sendRaw({ type: 'host.heartbeat', timestamp: this.lastHeartbeat });
  }

  private sendRaw(value: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value));
  }

  private disconnect(): void {
    this.ready = false;
    this.connecting = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.close();
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('COMPANION_MESSAGE_INVALID');
  return value;
}

function stableCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^[A-Z0-9_]+$/.test(message) ? message : 'COMPANION_INTERNAL_ERROR';
}
