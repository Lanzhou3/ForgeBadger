import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  CircuitBreaker,
  circuitBreakerFor,
  defaultCircuitBreakerConfig,
  resetAllCircuitBreakers,
  type CircuitBreakerConfig
} from "../src/services/claude-route/circuit-breaker.js";

function testConfig(overrides: Partial<CircuitBreakerConfig> = {}): CircuitBreakerConfig {
  return { ...defaultCircuitBreakerConfig, ...overrides };
}

describe("CircuitBreaker state machine", () => {
  beforeEach(() => resetAllCircuitBreakers());

  it("allows everything while closed and trips after the consecutive failure threshold", () => {
    const breaker = new CircuitBreaker(testConfig({ failureThreshold: 3 }));
    for (let i = 0; i < 2; i++) {
      assert.equal(breaker.allow().allowed, true);
      breaker.recordFailure(false);
    }
    assert.equal(breaker.getState(), "closed");
    breaker.recordFailure(false);
    assert.equal(breaker.getState(), "open");
    assert.equal(breaker.allow().allowed, false);
  });

  it("a success in closed resets the consecutive failure count", () => {
    const breaker = new CircuitBreaker(testConfig({ failureThreshold: 3 }));
    breaker.recordFailure(false);
    breaker.recordFailure(false);
    breaker.recordSuccess(false);
    breaker.recordFailure(false);
    breaker.recordFailure(false);
    assert.equal(breaker.getState(), "closed", "3 consecutive failures are needed, not cumulative");
    breaker.recordFailure(false);
    assert.equal(breaker.getState(), "open");
  });

  it("trips on cumulative error rate once the minimum request count is met", () => {
    const breaker = new CircuitBreaker(testConfig({ failureThreshold: 99, minRequests: 10, errorRateThreshold: 0.6 }));
    // 6 failures interleaved with 4 successes: 60% rate, below the 10-request minimum.
    const pattern = ["f", "s", "f", "s", "f", "s", "f", "s", "f", "f"] as const;
    for (const outcome of pattern) {
      assert.equal(breaker.allow().allowed, true);
      if (outcome === "f") breaker.recordFailure(false);
      else breaker.recordSuccess(false);
    }
    assert.equal(breaker.getState(), "open");
    assert.equal(breaker.allow().allowed, false);
  });

  it("does not trip on error rate before the minimum request count", () => {
    const breaker = new CircuitBreaker(testConfig({ failureThreshold: 99, minRequests: 10, errorRateThreshold: 0.6 }));
    // 4/4 failures = 100% rate, but only 4 recorded requests.
    for (let i = 0; i < 4; i++) breaker.recordFailure(false);
    assert.equal(breaker.getState(), "closed");
  });

  it("stays open until the timeout elapses, then admits a single half-open probe", () => {
    let clock = 1_000;
    const breaker = new CircuitBreaker(testConfig({ failureThreshold: 1, openTimeoutMs: 60_000 }), () => clock);
    breaker.recordFailure(false);
    assert.equal(breaker.getState(), "open");

    // Inside the window: denied.
    clock += 30_000;
    assert.equal(breaker.allow().allowed, false);

    // After the window: the first request takes the probe slot, the second
    // concurrent request is denied while the probe is in flight.
    clock += 30_000;
    const probe = breaker.allow();
    assert.equal(probe.allowed, true);
    assert.equal(probe.usedHalfOpenPermit, true);
    assert.equal(breaker.getState(), "half_open");
    assert.equal(breaker.allow().allowed, false);
  });

  it("a failed probe re-opens the breaker with a fresh window", () => {
    let clock = 1_000;
    const breaker = new CircuitBreaker(testConfig({ failureThreshold: 1, openTimeoutMs: 60_000 }), () => clock);
    breaker.recordFailure(false);
    clock += 60_000;
    const probe = breaker.allow();
    assert.equal(probe.allowed, true);
    breaker.recordFailure(probe.usedHalfOpenPermit);
    assert.equal(breaker.getState(), "open");

    // The fresh window must elapse again.
    clock += 59_999;
    assert.equal(breaker.allow().allowed, false);
    clock += 1;
    assert.equal(breaker.allow().allowed, true);
  });

  it("closes after the success threshold of consecutive probe successes", () => {
    let clock = 1_000;
    const breaker = new CircuitBreaker(
      testConfig({ failureThreshold: 1, successThreshold: 2, openTimeoutMs: 60_000 }),
      () => clock
    );
    breaker.recordFailure(false);
    clock += 60_000;
    const first = breaker.allow();
    breaker.recordSuccess(first.usedHalfOpenPermit);
    assert.equal(breaker.getState(), "half_open", "one success is not enough");
    const second = breaker.allow();
    assert.equal(second.usedHalfOpenPermit, true);
    breaker.recordSuccess(second.usedHalfOpenPermit);
    assert.equal(breaker.getState(), "closed");
    assert.equal(breaker.allow().usedHalfOpenPermit, false, "closed traffic needs no probe slot");
    // Counters restart from a clean slate.
    assert.deepEqual(
      breaker.getStats(),
      { state: "closed", consecutiveFailures: 0, consecutiveSuccesses: 0, totalRequests: 0, failedRequests: 0, lastOpenedAt: null }
    );
  });

  it("a probe failure resets the consecutive probe success count", () => {
    let clock = 1_000;
    const breaker = new CircuitBreaker(
      testConfig({ failureThreshold: 1, successThreshold: 2, openTimeoutMs: 1_000 }),
      () => clock
    );
    breaker.recordFailure(false);
    clock += 1_000;
    breaker.recordSuccess(breaker.allow().usedHalfOpenPermit); // 1 of 2
    // The open timeout is short; a fresh probe window opens immediately.
    clock += 1_000;
    const probe = breaker.allow();
    assert.equal(probe.allowed, true);
    breaker.recordFailure(probe.usedHalfOpenPermit); // back to open, success count reset
    assert.equal(breaker.getState(), "open");
  });

  it("a neutral completion releases the probe slot without touching health counters", () => {
    let clock = 1_000;
    const breaker = new CircuitBreaker(
      testConfig({ failureThreshold: 2, successThreshold: 2, openTimeoutMs: 1_000 }),
      () => clock
    );
    breaker.recordFailure(false);
    breaker.recordFailure(false);
    assert.equal(breaker.getState(), "open");
    clock += 1_000;
    const probe = breaker.allow();
    assert.equal(probe.allowed, true);
    assert.equal(breaker.getStats().totalRequests, 2);

    breaker.releaseNeutral(probe.usedHalfOpenPermit);
    // The state was already half_open once allow() admitted the probe; the
    // neutral completion neither heals (closed) nor re-trips (open).
    assert.equal(breaker.getState(), "half_open", "neutral outcomes neither heal nor trip");
    assert.equal(breaker.getStats().totalRequests, 2, "no request was recorded");
    assert.equal(breaker.getStats().failedRequests, 2);
    // The slot is free: the next request can probe again.
    assert.equal(breaker.allow().allowed, true);
  });

  it("double-releasing a probe slot is a no-op", () => {
    let clock = 1_000;
    const breaker = new CircuitBreaker(testConfig({ failureThreshold: 1, openTimeoutMs: 1_000 }), () => clock);
    breaker.recordFailure(false);
    clock += 1_000;
    const probe = breaker.allow();
    assert.equal(probe.usedHalfOpenPermit, true);
    breaker.releaseNeutral(true);
    breaker.releaseNeutral(true);
    assert.equal(breaker.allow().allowed, true, "the slot cannot go negative into admitting extra probes");
  });

  it("reset() closes the breaker and clears all counters", () => {
    const breaker = new CircuitBreaker(testConfig({ failureThreshold: 1 }));
    breaker.recordFailure(false);
    assert.equal(breaker.getState(), "open");
    breaker.reset();
    assert.equal(breaker.getState(), "closed");
    assert.equal(breaker.allow().allowed, true);
  });
});

describe("circuitBreakerFor registry", () => {
  beforeEach(() => resetAllCircuitBreakers());

  it("returns the same instance per user+provider and isolates other keys", () => {
    const a1 = circuitBreakerFor("user-1", "provider-1");
    const a2 = circuitBreakerFor("user-1", "provider-1");
    const b = circuitBreakerFor("user-2", "provider-1");
    assert.equal(a1, a2);
    assert.notEqual(a1, b);

    a1.recordFailure(false);
    a1.recordFailure(false);
    a1.recordFailure(false);
    a1.recordFailure(false);
    assert.equal(a1.getState(), "open");
    assert.equal(b.getState(), "closed", "health is per user+provider");
  });

  it("applies the given config only at creation", () => {
    const strict = circuitBreakerFor("user-1", "provider-x", testConfig({ failureThreshold: 1 }));
    strict.recordFailure(false);
    assert.equal(strict.getState(), "open");
    // The same instance is returned regardless of the config argument now.
    const same = circuitBreakerFor("user-1", "provider-x", testConfig({ failureThreshold: 99 }));
    assert.equal(same, strict);
  });

  it("resetAllCircuitBreakers starts every key closed", () => {
    const a = circuitBreakerFor("user-1", "provider-1", testConfig({ failureThreshold: 1 }));
    a.recordFailure(false);
    assert.equal(a.getState(), "open");
    resetAllCircuitBreakers();
    assert.equal(circuitBreakerFor("user-1", "provider-1").getState(), "closed");
  });
});
