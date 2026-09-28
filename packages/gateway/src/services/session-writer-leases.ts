import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { Database } from "../db/types.js";
import { SessionWriterLeaseRepository } from "../db/repositories/session-writer-lease-repository.js";

export interface WriterScope { userId: string; sessionId: string; workspace: string }
export interface WriterLease extends WriterScope { token: string; fence: number; expiresAt: number }

/** Production uses SQLite; isolated unit runtimes can omit persistence. */
export class SessionWriterLeases {
  private readonly writers = new Map<string, WriterLease>();
  private fence = 0;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(private readonly options: {db?:Database;now?:()=>number;ttlMs?:number} = {}) {
    this.now=options.now??Date.now;
    this.ttlMs=options.ttlMs??30_000;
    if(!Number.isSafeInteger(this.ttlMs)||this.ttlMs<=0)throw new Error("Invalid writer lease TTL");
  }

  private repository(userId: string): SessionWriterLeaseRepository | undefined {
    return this.options.db ? new SessionWriterLeaseRepository(this.options.db,userId) : undefined;
  }

  private workspace(path: string): string {
    // A missing workspace cannot be running; fallback supports session recovery
    // while preserving lexical aliases. Existing symlinks always resolve.
    try { return realpathSync(path); } catch { return resolve(path); }
  }

  acquire(scope: WriterScope): WriterLease {
    const workspace = this.workspace(scope.workspace);
    const repository=this.repository(scope.userId);
    if(repository)return repository.acquire(workspace,scope.sessionId,randomUUID(),this.now(),this.ttlMs);
    if ((this.writers.get(workspace)?.expiresAt??0)>this.now()) throw new Error("SESSION_WRITER_BUSY");
    const lease = Object.freeze({ ...scope, workspace, token: randomUUID(), fence: ++this.fence,expiresAt:this.now()+this.ttlMs });
    this.writers.set(workspace, lease);
    return lease;
  }

  assertCurrent(lease: WriterLease): void {
    const repository=this.repository(lease.userId);
    if(repository)return repository.assertCurrent(lease,this.now());
    if (this.writers.get(lease.workspace) !== lease || lease.expiresAt<=this.now()) throw new Error("SESSION_WRITER_FENCE_STALE");
  }

  release(lease: WriterLease): void {
    const repository=this.repository(lease.userId);
    if(repository)return repository.release(lease);
    if (this.writers.get(lease.workspace) === lease) this.writers.delete(lease.workspace);
  }

  assertManualInputAllowed(scope: WriterScope): void {
    const repository=this.repository(scope.userId);
    if(repository)return repository.assertAvailable(this.workspace(scope.workspace),this.now());
    if ((this.writers.get(this.workspace(scope.workspace))?.expiresAt??0)>this.now()) throw new Error("SESSION_WRITER_BUSY");
  }

  takeover(scope: WriterScope): void {
    const workspace = this.workspace(scope.workspace);
    const repository=this.repository(scope.userId);
    if(repository)return repository.takeover(workspace,scope.sessionId,this.now());
    const lease = this.writers.get(workspace);
    if (!lease) return;
    if (lease.userId !== scope.userId || lease.sessionId !== scope.sessionId) {
      throw new Error("SESSION_WRITER_BUSY");
    }
    this.writers.delete(workspace);
    ++this.fence;
  }

  revokeSession(userId: string, sessionId: string): void {
    const repository=this.repository(userId);
    if(repository)return repository.revokeSession(sessionId);
    for (const [workspace, lease] of this.writers) {
      if (lease.userId === userId && lease.sessionId === sessionId) this.writers.delete(workspace);
    }
    ++this.fence;
  }
}
