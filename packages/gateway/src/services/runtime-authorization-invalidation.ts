export type RuntimeAuthorizationInvalidation =
  | { scope: "user"; userId: string }
  | { scope: "session"; userId: string; sessionId: string }
  | { scope: "project"; userId: string; projectId: string };

type RuntimeAuthorizationInvalidationListener = (
  invalidation: RuntimeAuthorizationInvalidation
) => void;

/** Gateway-internal authorization signal; never forwarded to the public event stream. */
export class RuntimeAuthorizationInvalidator {
  private readonly listeners = new Set<RuntimeAuthorizationInvalidationListener>();

  subscribe(listener: RuntimeAuthorizationInvalidationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  invalidate(invalidation: RuntimeAuthorizationInvalidation): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(invalidation);
      } catch {
        // Authorization mutations have already committed. A faulty listener
        // must not turn the successful mutation into a misleading API error.
        console.error("[runtime-authorization] invalidation listener failed", {
          code: "RUNTIME_AUTHORIZATION_INVALIDATION_LISTENER_FAILED",
          scope: invalidation.scope
        });
      }
    }
  }
}
