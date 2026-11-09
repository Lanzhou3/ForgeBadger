import { z } from 'zod';
import type { CompanionSocket, CompanionPlatform } from './platform';
import {
  companionCommandReceiptSchema,
  companionDeviceSchema,
  companionSealedSchema,
  companionSnapshotSchema,
  companionSyncSchema,
  parseCompanionQr,
  type CompanionDevice,
  type CompanionIdentity,
  type CompanionQr,
  type CompanionRegistration,
  type CompanionSealedMessage,
  type CompanionSnapshot,
  type CompanionCommandReceipt
} from './protocol';

export type CompanionStatus = 'idle' | 'pairing' | 'awaiting_owner' | 'online' | 'offline' | 'revoked' | 'error';

export interface CompanionClientState {
  status: CompanionStatus;
  snapshot?: CompanionSnapshot | undefined;
  sas?: string | undefined;
  error?: string | undefined;
  hostOnline?: boolean | undefined;
  lastPresenceAt?: number | undefined;
  lastReceipt?: CompanionCommandReceipt | undefined;
}

interface PairingContext {
  qr: CompanionQr;
  identity: CompanionIdentity;
  deviceName: string;
  claimNonce: string;
}

interface PendingQuery {
  resolve: (payload: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class CompanionClient {
  private readonly listeners = new Set<(state: CompanionClientState) => void>();
  private state: CompanionClientState = { status: 'idle' };
  private identity: CompanionIdentity | undefined;
  private registration: CompanionRegistration | undefined;
  private pairing: PairingContext | undefined;
  private socket: CompanionSocket | undefined;
  private mode: 'pairing' | 'device' | undefined;
  private generation = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private closing = false;
  private cursor = 0;
  private readonly pending = new Map<string, PendingQuery>();

  constructor(private readonly platform: CompanionPlatform) {}

  getState(): CompanionClientState { return this.state; }

  subscribe(listener: (state: CompanionClientState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async restore(): Promise<void> {
    const stored = await this.platform.loadSession();
    const cache = await this.platform.loadCache();
    if (cache) {
      this.cursor = cache.cursor;
      this.patch({ snapshot: cache.snapshot, status: 'offline' });
    }
    if (!stored) return;
    this.identity = stored.identity;
    this.registration = stored.registration;
    if (this.registration) {
      this.mode = 'device';
      await this.connect(this.registration.relayUrl);
    }
  }

  async pair(rawQr: string, deviceName: string): Promise<void> {
    const qr = parseCompanionQr(rawQr);
    z.string().trim().min(1).max(80).parse(deviceName);
    const stored = await this.platform.loadSession();
    this.identity = stored?.identity ?? this.platform.crypto.generateIdentity();
    this.registration = undefined;
    this.cursor = 0;
    await this.platform.saveSession({ identity: this.identity });
    const claimNonce = this.platform.crypto.randomBytes(32);
    this.pairing = { qr, identity: this.identity, deviceName, claimNonce };
    this.mode = 'pairing';
    this.patch({ status: 'pairing', error: undefined, sas: undefined });
    await this.connect(qr.relayUrl);
  }

  async refresh(): Promise<void> {
    if (!this.registration || this.state.status === 'revoked') return;
    await this.refreshSnapshot();
  }

  async executeCommand(type: string, payload: unknown): Promise<CompanionCommandReceipt> {
    if (!this.registration || !this.identity) throw new Error('COMPANION_DEVICE_NOT_REGISTERED');
    if (this.state.status !== 'online') throw new Error('COMPANION_HOST_OFFLINE');
    const commandId = this.platform.crypto.randomUUID();
    const { device } = this.registration;
    const command = {
      protocolVersion: 1,
      hostId: device.hostId,
      deviceId: device.id,
      commandId,
      authorityRevision: device.authorityRevision,
      type,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      payloadDigest: this.platform.crypto.digestPayload(payload),
      payload
    };
    const result = new Promise<CompanionCommandReceipt>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        reject(new Error('COMPANION_COMMAND_TIMEOUT'));
      }, 15_000);
      this.pending.set(commandId, { resolve, reject, timer });
    });
    this.socket?.send({
      type: 'envelope',
      hostId: device.hostId,
      deviceId: device.id,
      messageId: commandId,
      kind: 'command',
      sealed: this.seal(command, this.registration.hostEncryptionPublicKey, `command:${device.hostId}:${device.id}:${commandId}`)
    });
    const receipt = companionCommandReceiptSchema.parse(await result);
    this.patch({ lastReceipt: receipt });
    if (receipt.errorCode === 'COMPANION_DEVICE_REVOKED') this.handleFailure(new Error(receipt.errorCode));
    await this.refreshSnapshot();
    return receipt;
  }

  async logout(): Promise<void> {
    this.closing = true;
    this.generation += 1;
    this.clearReconnect();
    this.socket?.close();
    this.socket = undefined;
    this.registration = undefined;
    this.pairing = undefined;
    this.identity = undefined;
    this.cursor = 0;
    this.rejectPending(new Error('COMPANION_CLOSED'));
    await this.platform.clearLocalData();
    this.patch({ status: 'idle', snapshot: undefined, sas: undefined, error: undefined, hostOnline: undefined });
  }

  close(): void {
    this.closing = true;
    this.generation += 1;
    this.clearReconnect();
    this.socket?.close();
    this.rejectPending(new Error('COMPANION_CLOSED'));
  }

  private async connect(relayUrl: string): Promise<void> {
    const generation = ++this.generation;
    this.socket?.close();
    try {
      const socket = await this.platform.connect(relayUrl);
      if (generation !== this.generation || this.closing) {
        socket.close();
        return;
      }
      this.socket = socket;
      socket.onMessage(value => { void this.handleMessage(value, generation); });
      socket.onClose(() => this.handleClose(generation));
      socket.onError(() => this.handleClose(generation));
      if (this.mode === 'pairing') this.sendClaim();
      if (this.mode === 'device') this.sendDeviceConnection();
    } catch (error) {
      this.handleFailure(error);
    }
  }

  private sendClaim(): void {
    if (!this.pairing || !this.identity) return;
    const { qr, deviceName, claimNonce } = this.pairing;
    const payload = {
      pairingId: qr.pairingId,
      secret: qr.secret,
      deviceName,
      signingPublicKey: this.identity.signingPublicKey,
      encryptionPublicKey: this.identity.encryptionPublicKey,
      claimNonce
    };
    this.socket?.send({
      type: 'pairing.claim', protocolVersion: 1, hostId: qr.hostId, pairingId: qr.pairingId,
      sealed: this.seal(payload, qr.hostEncryptionPublicKey, `pairing.claim:${qr.hostId}:${qr.pairingId}`)
    });
  }

  private sendDeviceConnection(): void {
    if (!this.registration || !this.identity) return;
    const connection = {
      type: 'device.connect', protocolVersion: 1,
      hostId: this.registration.device.hostId,
      deviceId: this.registration.device.id,
      nonce: this.platform.crypto.randomUUID(),
      timestamp: Date.now()
    };
    this.socket?.send({
      ...connection,
      signature: this.platform.crypto.signPayload(connection, this.identity.signingPrivateKey)
    });
  }

  private async handleMessage(raw: unknown, generation: number): Promise<void> {
    if (generation !== this.generation) return;
    try {
      const message = z.record(z.unknown()).parse(raw);
      if (message.type === 'pairing.claimed') {
        this.handleClaimed(message);
        return;
      }
      if (message.type === 'pairing.claim.failed') {
        throw new Error(typeof message.code === 'string' ? message.code : 'COMPANION_PAIRING_REJECTED');
      }
      if (message.type === 'device.ready') {
        if (this.mode === 'device') await this.syncAfterReconnect();
        return;
      }
      if (message.type === 'presence') {
        this.patch({
          hostOnline: message.online === true,
          lastPresenceAt: typeof message.generatedAt === 'number' ? message.generatedAt : Date.now()
        });
        return;
      }
      if (message.type === 'error') {
        const code = typeof message.code === 'string' ? message.code : 'COMPANION_RELAY_UNAVAILABLE';
        if (code === 'COMPANION_DEVICE_AUTH_FAILED' || code === 'COMPANION_DEVICE_REVOKED') {
          this.patch({ status: 'revoked', error: code });
          this.clearReconnect();
          return;
        }
        throw new Error(code);
      }
      if (message.type !== 'envelope') return;
      const hostId = requiredString(message.hostId);
      const deviceId = requiredString(message.deviceId);
      const messageId = requiredString(message.messageId);
      const kind = requiredString(message.kind);
      const sealed = companionSealedSchema.parse(message.sealed);
      const opened = this.open(sealed, `${kind}:${hostId}:${deviceId}:${messageId}`);
      if (kind === 'event') await this.handleEvent(opened);
      if (kind === 'query_result' || kind === 'command_receipt') this.handleQueryResult(messageId, opened);
    } catch (error) {
      this.handleFailure(error);
    }
  }

  private handleClaimed(message: Record<string, unknown>): void {
    if (!this.pairing) return;
    const { qr, identity, claimNonce } = this.pairing;
    const opened = this.open(
      companionSealedSchema.parse(message.sealed),
      `pairing.claimed:${qr.hostId}:${qr.pairingId}`,
      qr.hostSigningPublicKey
    ) as { sas: string };
    const expected = this.platform.crypto.derivePairingSas({
      secret: qr.secret,
      hostId: qr.hostId,
      pairingId: qr.pairingId,
      hostSigningPublicKey: qr.hostSigningPublicKey,
      deviceSigningPublicKey: identity.signingPublicKey,
      claimNonce
    });
    if (opened.sas !== expected) throw new Error('COMPANION_PAIRING_MISMATCH');
    this.patch({ status: 'awaiting_owner', sas: expected, error: undefined });
  }

  private async handleEvent(payload: any): Promise<void> {
    const type = requiredString(payload.type);
    const sequence = z.number().int().positive().parse(payload.sequence);
    if (this.registration && sequence <= this.cursor) return;
    if (type === 'device.confirmed' && this.pairing) {
      const device = companionDeviceSchema.parse(payload.device);
      this.registration = {
        device,
        hostSigningPublicKey: this.pairing.qr.hostSigningPublicKey,
        hostEncryptionPublicKey: this.pairing.qr.hostEncryptionPublicKey,
        relayUrl: this.pairing.qr.relayUrl
      };
      this.cursor = sequence;
      this.mode = 'device';
      await this.platform.saveSession({ identity: this.identity!, registration: this.registration });
      this.pairing = undefined;
      this.patch({ status: 'online', sas: undefined, error: undefined });
      await this.refreshSnapshot();
      return;
    }
    if (!this.registration) return;
    this.cursor = Math.max(this.cursor, sequence);
    if (type === 'device.updated') {
      const device = companionDeviceSchema.parse(payload.device);
      this.registration = { ...this.registration, device };
      await this.platform.saveSession({ identity: this.identity!, registration: this.registration });
    }
    if (type === 'device.revoked') {
      this.patch({ status: 'revoked', error: 'COMPANION_DEVICE_REVOKED' });
      this.clearReconnect();
      return;
    }
    await this.refreshSnapshot();
  }

  private handleQueryResult(messageId: string, payload: any): void {
    const pending = this.pending.get(messageId);
    if (!pending) return;
    this.pending.delete(messageId);
    clearTimeout(pending.timer);
    if (payload.ok === false) {
      pending.reject(new Error(requiredString(payload.code)));
      return;
    }
    pending.resolve(payload);
  }

  private async syncAfterReconnect(): Promise<void> {
    this.socket?.send({ type: 'presence.get' });
    const result = await this.query('sync', {
      type: 'sync',
      authorityRevision: this.registration!.device.authorityRevision,
      afterSequence: this.cursor
    });
    const sync = companionSyncSchema.parse(result.sync);
    this.patch({ status: 'online', error: undefined });
    if (sync.reset) {
      await this.refreshSnapshot();
      return;
    }
    const hasUpdates = sync.events.length > 0 || sync.latestSequence > this.cursor;
    this.cursor = Math.max(this.cursor, sync.latestSequence);
    if (hasUpdates) await this.refreshSnapshot();
    else await this.saveCache();
  }

  private async refreshSnapshot(): Promise<void> {
    if (!this.registration) return;
    const result = await this.query('snapshot', {
      type: 'snapshot',
      authorityRevision: this.registration.device.authorityRevision
    });
    const snapshot = companionSnapshotSchema.parse(result.snapshot);
    this.cursor = Math.max(this.cursor, snapshot.latestSequence);
    this.registration = { ...this.registration, device: snapshot.device };
    await this.platform.saveSession({ identity: this.identity!, registration: this.registration });
    this.patch({ status: 'online', snapshot, error: undefined });
    await this.saveCache();
  }

  private query(kind: 'snapshot' | 'sync', payload: unknown): Promise<any> {
    if (!this.registration || !this.identity) return Promise.reject(new Error('COMPANION_DEVICE_NOT_REGISTERED'));
    const messageId = this.platform.crypto.randomUUID();
    const { device } = this.registration;
    const result = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(messageId);
        reject(new Error('COMPANION_QUERY_TIMEOUT'));
      }, 10_000);
      this.pending.set(messageId, { resolve, reject, timer });
    });
    this.socket?.send({
      type: 'envelope',
      hostId: device.hostId,
      deviceId: device.id,
      messageId,
      kind: 'query',
      sealed: this.seal(payload, this.registration.hostEncryptionPublicKey, `query:${device.hostId}:${device.id}:${messageId}`)
    });
    return result;
  }

  private seal(payload: unknown, recipient: string, context: string): CompanionSealedMessage {
    if (!this.identity) throw new Error('COMPANION_DEVICE_KEY_INVALID');
    return this.platform.crypto.sealMessage({
      payload,
      signingPrivateKey: this.identity.signingPrivateKey,
      encryptionPrivateKey: this.identity.encryptionPrivateKey,
      recipientEncryptionPublicKey: recipient,
      context
    });
  }

  private open(sealed: CompanionSealedMessage, context: string, expectedHostKey?: string): any {
    if (!this.identity) throw new Error('COMPANION_DEVICE_KEY_INVALID');
    const expected = expectedHostKey ?? this.registration?.hostSigningPublicKey ?? this.pairing?.qr.hostSigningPublicKey;
    return this.platform.crypto.openMessage({
      sealed,
      encryptionPrivateKey: this.identity.encryptionPrivateKey,
      context,
      expectedSigningPublicKey: expected
    }).payload;
  }

  private handleClose(generation: number): void {
    if (generation !== this.generation || this.closing) return;
    this.rejectPending(new Error('COMPANION_RELAY_CLOSED'));
    this.patch({ status: this.registration ? 'offline' : 'error', error: 'COMPANION_RELAY_CLOSED' });
    if (this.registration && this.state.status !== 'revoked') this.scheduleReconnect();
  }

  private handleFailure(error: unknown): void {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : 'COMPANION_INTERNAL_ERROR';
    if (code === 'COMPANION_DEVICE_REVOKED' || code === 'COMPANION_DEVICE_AUTH_FAILED') {
      this.clearReconnect();
      this.patch({ status: 'revoked', error: code });
      return;
    }
    this.patch({ status: this.registration ? 'offline' : 'error', error: code });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closing) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempts, 5));
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.registration) void this.connect(this.registration.relayUrl);
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.reconnectAttempts = 0;
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private async saveCache(): Promise<void> {
    if (!this.state.snapshot) return;
    await this.platform.saveCache({
      snapshot: this.state.snapshot,
      cursor: this.cursor,
      savedAt: Date.now()
    });
  }

  private patch(next: Partial<CompanionClientState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener(this.state);
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('COMPANION_MESSAGE_INVALID');
  return value;
}
