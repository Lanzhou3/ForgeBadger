/**
 * Runtime health circuit breaker for Claude-route providers.
 *
 * A routed provider that keeps failing (rate limits that never clear,
 * overload, a dead endpoint) must not keep getting hammered: once the
 * breaker opens, requests are answered 503 without touching the upstream —
 * Claude Code backs off on 503 — and after the open window a single
 * half-open probe retests the provider before traffic is admitted again.
 *
 * Scope and lifetime: per user + provider, in-memory per Gateway process.
 * Health is a runtime signal, not persisted state; a restart starts closed.
 *
 * Outcome classification (one record per client request, decided by the
 * forwarder):
 * - success: the request was delivered (any attempt), including after
 *   internal retries or a rectified resubmission
 * - provider failure: the final failure is an upstream condition
 *   (retryable status, connection error, stalled/empty stream, unusable 200)
 * - neutral: the final failure is a client-side rejection (4xx) or a
 *   Gateway-side configuration problem — it must not pollute provider health
 *
 * The half-open probe slot is released by whichever of the three completions
 * runs, so a neutral probe outcome frees the slot without touching counters.
 */

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerConfig {
  /** Consecutive provider failures that trip the breaker (Closed → Open). */
  failureThreshold: number;
  /** Consecutive probe successes needed to close from HalfOpen. */
  successThreshold: number;
  /** How long the breaker stays Open before admitting a half-open probe. */
  openTimeoutMs: number;
  /** Cumulative error rate that trips the breaker once minRequests is met. */
  errorRateThreshold: number;
  /** Minimum recorded requests before the error-rate rule applies. */
  minRequests: number;
}

export const defaultCircuitBreakerConfig: Readonly<CircuitBreakerConfig> = Object.freeze({
  failureThreshold: 4,
  successThreshold: 2,
  openTimeoutMs: 60_000,
  errorRateThreshold: 0.6,
  minRequests: 10
});

export interface CircuitDecision {
  allowed: boolean;
  /**
   * True when this decision consumed the single half-open probe slot. The
   * completion of the guarded request must call recordSuccess /
   * recordFailure / releaseNeutral with the same flag so the slot is
   * released exactly once.
   */
  usedHalfOpenPermit: boolean;
}

export interface CircuitStats {
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  totalRequests: number;
  failedRequests: number;
  lastOpenedAt: number | null;
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private totalRequests = 0;
  private failedRequests = 0;
  private lastOpenedAt: number | null = null;
  private halfOpenPermits = 0;

  constructor(
    readonly config: CircuitBreakerConfig,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Admits or refuses the next request. A timed-out Open transitions to
   * HalfOpen first, then follows the current state.
   */
  allow(): CircuitDecision {
    if (this.state === "open" && this.lastOpenedAt !== null
      && this.now() - this.lastOpenedAt >= this.config.openTimeoutMs) {
      this.transitionToHalfOpen();
    }
    switch (this.state) {
      case "closed":
        return { allowed: true, usedHalfOpenPermit: false };
      case "half_open":
        return this.allowHalfOpenProbe();
      case "open":
        return { allowed: false, usedHalfOpenPermit: false };
    }
  }

  recordSuccess(usedHalfOpenPermit: boolean): void {
    this.releasePermit(usedHalfOpenPermit);
    this.consecutiveFailures = 0;
    this.totalRequests += 1;
    if (this.state === "half_open") {
      this.consecutiveSuccesses += 1;
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.transitionToClosed();
      }
    }
  }

  recordFailure(usedHalfOpenPermit: boolean): void {
    this.releasePermit(usedHalfOpenPermit);
    this.consecutiveFailures += 1;
    this.totalRequests += 1;
    this.failedRequests += 1;
    this.consecutiveSuccesses = 0;

    if (this.state === "half_open") {
      // A failed probe immediately re-opens (fresh timeout window).
      this.transitionToOpen();
      return;
    }
    if (this.state === "closed") {
      if (this.consecutiveFailures >= this.config.failureThreshold) {
        this.transitionToOpen();
        return;
      }
      if (this.totalRequests >= this.config.minRequests
        && this.failedRequests / this.totalRequests >= this.config.errorRateThreshold) {
        this.transitionToOpen();
      }
    }
  }

  /**
   * Completes a guarded request whose outcome must not affect provider
   * health (client-side rejections) while still releasing a probe slot.
   */
  releaseNeutral(usedHalfOpenPermit: boolean): void {
    this.releasePermit(usedHalfOpenPermit);
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats(): CircuitStats {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      totalRequests: this.totalRequests,
      failedRequests: this.failedRequests,
      lastOpenedAt: this.lastOpenedAt
    };
  }

  /** Manual recovery (reserved for an admin endpoint; not wired yet). */
  reset(): void {
    this.transitionToClosed();
  }

  private allowHalfOpenProbe(): CircuitDecision {
    if (this.halfOpenPermits < 1) {
      this.halfOpenPermits += 1;
      return { allowed: true, usedHalfOpenPermit: true };
    }
    return { allowed: false, usedHalfOpenPermit: false };
  }

  private releasePermit(used: boolean): void {
    if (used && this.halfOpenPermits > 0) {
      this.halfOpenPermits -= 1;
    }
  }

  private transitionToOpen(): void {
    this.state = "open";
    this.lastOpenedAt = this.now();
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
  }

  private transitionToHalfOpen(): void {
    if (this.state !== "open") return;
    this.state = "half_open";
    this.consecutiveSuccesses = 0;
    this.halfOpenPermits = 0;
  }

  private transitionToClosed(): void {
    this.state = "closed";
    this.lastOpenedAt = null;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.totalRequests = 0;
    this.failedRequests = 0;
    this.halfOpenPermits = 0;
  }
}

// ---- Registry (per user + provider) ----------------------------------------

const breakers = new Map<string, CircuitBreaker>();

function breakerKey(userId: string, providerId: string): string {
  return `${userId}:${providerId}`;
}

/**
 * Returns the breaker for a user's routed provider, creating it on first use.
 * `config` only applies at creation; the same instance is returned on later
 * calls so state survives across requests.
 */
export function circuitBreakerFor(
  userId: string,
  providerId: string,
  config: CircuitBreakerConfig = defaultCircuitBreakerConfig
): CircuitBreaker {
  const key = breakerKey(userId, providerId);
  let breaker = breakers.get(key);
  if (!breaker) {
    breaker = new CircuitBreaker(config);
    breakers.set(key, breaker);
  }
  return breaker;
}

/** Test helper: drops every breaker so suites start from a closed state. */
export function resetAllCircuitBreakers(): void {
  breakers.clear();
}
