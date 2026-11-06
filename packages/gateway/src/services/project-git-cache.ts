import type { ProjectGitChanges } from "./project-git.js";

interface CacheEntry {
  value: ProjectGitChanges;
  expiresAt: number;
  bytes: number;
  timer: ReturnType<typeof setTimeout>;
}

/** Bounds retained Git payloads; expiry releases idle projects without another read. */
export class ProjectGitChangesCache {
  private readonly entries = new Map<string, CacheEntry>();
  private bytes = 0;

  constructor(private readonly limits = { ttlMs: 5_000, maxEntries: 64, maxBytes: 16 * 1024 * 1024 }) {}

  get size(): number { return this.entries.size; }

  get(key: string): ProjectGitChanges | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: ProjectGitChanges): void {
    this.delete(key);
    const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
    if (bytes > this.limits.maxBytes) return;
    while (this.entries.size >= this.limits.maxEntries || this.bytes + bytes > this.limits.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.delete(oldest);
    }
    const entry: CacheEntry = {
      value, bytes, expiresAt: Date.now() + this.limits.ttlMs,
      timer: setTimeout(() => {
        if (this.entries.get(key) === entry) this.delete(key);
      }, this.limits.ttlMs)
    };
    entry.timer.unref();
    this.entries.set(key, entry);
    this.bytes += bytes;
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.entries.delete(key);
    this.bytes -= entry.bytes;
  }
}
