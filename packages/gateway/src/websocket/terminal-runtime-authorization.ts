import {
  RuntimeAuthorizationInvalidator,
  type RuntimeAuthorizationInvalidation
} from "../services/runtime-authorization-invalidation.js";
import { UserRepository } from "../db/repositories/user-repository.js";
import { SessionRepository } from "../db/repositories/session-repository.js";
import type { Database } from "../db/types.js";

export function validateTerminalRuntimeAuthorization(
  db: Database,
  userId: string,
  sessionId: string
): boolean {
  try {
    const user = new UserRepository(db).findById(userId);
    if (!user || user.status !== "active") return false;
    // Tenant isolation is carried by the user-scoped session lookup itself.
    const session = new SessionRepository(db, userId).getById(sessionId);
    if (!session) return false;
    return true;
  } catch {
    return false;
  }
}

export interface TerminalRuntimeAuthorizationDescriptor {
  userId: string;
  sessionId: string;
  projectId: string;
  revalidate(): boolean;
  onInvalidated(): void;
}

export interface TerminalRuntimeAuthorizationLease {
  isAuthorized(): boolean;
  dispose(): void;
}

interface AuthorizationEntry extends TerminalRuntimeAuthorizationDescriptor {
  authorized: boolean;
  disposed: boolean;
}

export class TerminalRuntimeAuthorizationRegistry {
  private readonly byUser = new Map<string, Set<AuthorizationEntry>>();
  private readonly bySession = new Map<string, Set<AuthorizationEntry>>();
  private readonly byProject = new Map<string, Set<AuthorizationEntry>>();

  constructor(invalidator: RuntimeAuthorizationInvalidator) {
    invalidator.subscribe((invalidation) => {
      this.handleInvalidation(invalidation);
    });
  }

  open(descriptor: TerminalRuntimeAuthorizationDescriptor): TerminalRuntimeAuthorizationLease {
    const entry: AuthorizationEntry = {
      ...descriptor,
      authorized: true,
      disposed: false
    };
    this.add(this.byUser, descriptor.userId, entry);
    this.add(this.bySession, this.sessionKey(descriptor.userId, descriptor.sessionId), entry);
    this.add(this.byProject, this.projectKey(descriptor.userId, descriptor.projectId), entry);
    this.revalidate(entry);

    return {
      isAuthorized: () => entry.authorized && !entry.disposed,
      dispose: () => this.dispose(entry)
    };
  }

  private handleInvalidation(invalidation: RuntimeAuthorizationInvalidation): void {
    const entries = this.entriesFor(invalidation);
    for (const entry of [...entries]) {
      this.revalidate(entry);
    }
  }

  private entriesFor(invalidation: RuntimeAuthorizationInvalidation): Set<AuthorizationEntry> {
    if (invalidation.scope === "user") {
      return this.byUser.get(invalidation.userId) ?? new Set();
    }
    if (invalidation.scope === "session") {
      return this.bySession.get(this.sessionKey(invalidation.userId, invalidation.sessionId)) ?? new Set();
    }
    return this.byProject.get(this.projectKey(invalidation.userId, invalidation.projectId)) ?? new Set();
  }

  private revalidate(entry: AuthorizationEntry): void {
    if (entry.disposed) return;
    try {
      if (entry.revalidate()) return;
    } catch {
      // Authorization lookup failures are fail-closed.
    }
    entry.authorized = false;
    this.dispose(entry);
    try {
      entry.onInvalidated();
    } catch {
      // One broken connection must not block invalidation of the remaining set.
    }
  }

  private dispose(entry: AuthorizationEntry): void {
    if (entry.disposed) return;
    entry.disposed = true;
    this.remove(this.byUser, entry.userId, entry);
    this.remove(this.bySession, this.sessionKey(entry.userId, entry.sessionId), entry);
    this.remove(this.byProject, this.projectKey(entry.userId, entry.projectId), entry);
  }

  private add(index: Map<string, Set<AuthorizationEntry>>, key: string, entry: AuthorizationEntry): void {
    const entries = index.get(key) ?? new Set<AuthorizationEntry>();
    entries.add(entry);
    index.set(key, entries);
  }

  private remove(index: Map<string, Set<AuthorizationEntry>>, key: string, entry: AuthorizationEntry): void {
    const entries = index.get(key);
    if (!entries) return;
    entries.delete(entry);
    if (entries.size === 0) index.delete(key);
  }

  private sessionKey(userId: string, sessionId: string): string {
    return `${userId}\0${sessionId}`;
  }

  private projectKey(userId: string, projectId: string): string {
    return `${userId}\0${projectId}`;
  }
}
