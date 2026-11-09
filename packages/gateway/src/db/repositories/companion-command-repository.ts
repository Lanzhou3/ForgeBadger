import type { Database } from '../types.js';

export interface CompanionCommandRecord {
  id: string;
  userId: string;
  deviceId: string;
  type: string;
  payloadEncrypted: string;
  payloadDigest: string;
  status: 'accepted' | 'running' | 'succeeded' | 'rejected' | 'failed' | 'unknown';
  effectStatus: 'none' | 'confirmed' | 'unknown';
  authorityRevision: number;
  resultReference: string | null;
  errorCode: string | null;
  createdAt: number;
  updatedAt: number;
}

const columns = `id,user_id AS userId,device_id AS deviceId,command_type AS type,
  payload_encrypted AS payloadEncrypted,payload_digest AS payloadDigest,status,effect_status AS effectStatus,
  authority_revision AS authorityRevision,result_reference AS resultReference,error_code AS errorCode,
  created_at AS createdAt,updated_at AS updatedAt`;

export class CompanionCommandRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}

  create(input: {
    id: string;
    deviceId: string;
    type: string;
    payloadEncrypted: string;
    payloadDigest: string;
    authorityRevision: number;
    resultReference: string | null;
    now: number;
  }): CompanionCommandRecord {
    this.db.prepare(`INSERT INTO companion_commands(id,user_id,device_id,command_type,payload_encrypted,
      payload_digest,authority_revision,result_reference,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      input.id, this.userId, input.deviceId, input.type, input.payloadEncrypted,
      input.payloadDigest, input.authorityRevision, input.resultReference, input.now, input.now
    );
    return this.get(input.deviceId, input.id)!;
  }

  get(deviceId: string, id: string): CompanionCommandRecord | undefined {
    return this.db.prepare(`SELECT ${columns} FROM companion_commands WHERE user_id=? AND device_id=? AND id=?`)
      .get(this.userId, deviceId, id) as CompanionCommandRecord | undefined;
  }

  update(record: CompanionCommandRecord, input: {
    status: CompanionCommandRecord['status'];
    effectStatus: CompanionCommandRecord['effectStatus'];
    resultReference?: string | null;
    errorCode?: string | null;
    now: number;
  }): CompanionCommandRecord {
    this.db.prepare(`UPDATE companion_commands SET status=?,effect_status=?,result_reference=?,error_code=?,updated_at=?
      WHERE user_id=? AND device_id=? AND id=?`).run(
      input.status, input.effectStatus,
      input.resultReference === undefined ? record.resultReference : input.resultReference,
      input.errorCode === undefined ? record.errorCode : input.errorCode,
      input.now, this.userId, record.deviceId, record.id
    );
    return this.get(record.deviceId, record.id)!;
  }

  list(deviceId: string, limit = 20): CompanionCommandRecord[] {
    return this.db.prepare(`SELECT ${columns} FROM companion_commands WHERE user_id=? AND device_id=?
      ORDER BY updated_at DESC,rowid DESC LIMIT ?`).all(this.userId, deviceId, Math.max(1, Math.min(100, limit))) as CompanionCommandRecord[];
  }

  unfinished(): CompanionCommandRecord[] {
    return this.db.prepare(`SELECT ${columns} FROM companion_commands
      WHERE user_id=? AND status IN ('accepted','running') ORDER BY updated_at`).all(this.userId) as CompanionCommandRecord[];
  }
}
