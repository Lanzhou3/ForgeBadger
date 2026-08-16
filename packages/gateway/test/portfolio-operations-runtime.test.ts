import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PortfolioRepository } from "../src/db/repositories/portfolio-repository.js";
import { createPortfolioSchedulerRepositoryFactory } from "../src/db/repositories/portfolio-scheduler-repository.js";
import { PortfolioObservationError } from "../src/services/portfolio/observation-contract.js";
import {
  type Clock,
  type FixedGitExecutor,
  type ProjectRootValidator
} from "../src/services/portfolio/observation-service.js";
import { OperationsRuntime, type Timer } from "../src/services/portfolio/operations-runtime.js";
import { provisionActiveObservationProfiles } from "../src/services/portfolio/observation-profile-provisioning.js";
import { createGatewayRuntime } from "../src/runtime/start-gateway.js";
import type { TmuxClient } from "../src/services/tmux.js";
import {
  activatePortfolioObservationProfile,
  createExecutablePortfolioAttempt,
  createPortfolioPhase4Fixture,
  type PortfolioPhase4Fixture
} from "./portfolio-phase4-fixture.js";

const now = new Date("2026-08-15T00:00:00.000Z");
const masterKey = "0123456789abcdef0123456789abcdef";

/** Runtime time is injected so no test observes Date.now-dependent ledger behavior. */
class MutableClock implements Clock {
  constructor(private value: Date) {}

  now(): Date {
    return new Date(this.value);
  }
}

class FakeTimer implements Timer {
  // The fake records scheduling rather than advancing wall time.
  readonly periods: number[] = [];
  readonly callbacks: Array<() => void> = [];
  readonly cleared: unknown[] = [];
  readonly events: string[] = [];

  setInterval(callback: () => void, ms: number): unknown {
    this.callbacks.push(callback);
    this.periods.push(ms);
    return callback;
  }

  clearInterval(handle: unknown): void {
    this.cleared.push(handle);
    this.events.push("timer:cleared");
  }
}

class FakeRootValidator implements ProjectRootValidator {
  // Runtime tests only permit an injected project-root validation port.
  identity = { canonicalPath: "/canonical/portfolio-phase4", device: 41, inode: 99 };

  validate() {
    return this.identity;
  }
}

class FakeGitExecutor implements FixedGitExecutor {
  // Calls are observable proof that the runtime neither shells out nor probes after stop.
  readonly calls: Parameters<FixedGitExecutor["execute"]>[0][] = [];
  response = { stdout: "## main\n", stderr: "", exitCode: 0 };

  async execute(input: Parameters<FixedGitExecutor["execute"]>[0]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    this.calls.push(input);
    return this.response;
  }
}

class BlockingGitExecutor implements FixedGitExecutor {
  readonly calls: Parameters<FixedGitExecutor["execute"]>[0][] = [];
  readonly events: string[];
  private resolveStarted: (() => void) | undefined;
  readonly started = new Promise<void>((resolve) => {
    this.resolveStarted = resolve;
  });

  constructor(events: string[]) {
    this.events = events;
  }

  execute(input: Parameters<FixedGitExecutor["execute"]>[0]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    this.calls.push(input);
    this.events.push("git:started");
    this.resolveStarted?.();
    return new Promise((_, reject) => {
      input.signal?.addEventListener("abort", () => {
        this.events.push("git:aborted");
        reject(new PortfolioObservationError("PORTFOLIO_OBSERVATION_GIT_ABORTED"));
      }, { once: true });
    });
  }
}

function count(db: PortfolioPhase4Fixture["db"], table: string, where = ""): number {
  const sql = `SELECT COUNT(*) AS count FROM ${table}${where ? ` WHERE ${where}` : ""}`;
  return (db.prepare(sql).get() as { count: number }).count;
}

function addTrackedWakeups(fixture: PortfolioPhase4Fixture, amount: number, keyPrefix: string): void {
  const scheduler = createPortfolioSchedulerRepositoryFactory(fixture.db).forUser(fixture.owner.id);
  for (let index = 0; index < amount; index += 1) {
    const attempt = createExecutablePortfolioAttempt(fixture.repository, {
      projectId: fixture.projectId,
      workItemId: fixture.workItem.id,
      packetVersion: 1,
      adapter: "claude",
      createdBy: fixture.owner.id,
      trackingEnabled: true,
      idempotencyKey: `${keyPrefix}:attempt:${index}`
    });
    scheduler.scheduleWakeup({
      projectId: fixture.projectId,
      workItemId: fixture.workItem.id,
      attemptId: attempt.id,
      reasonClass: "forecast_checkpoint",
      dueAt: now,
      coalescingKey: `${keyPrefix}:coalesce:${index}`,
      idempotencyKey: `${keyPrefix}:wakeup:${index}`,
      now
    });
  }
}

function createRuntime(fixture: PortfolioPhase4Fixture, timer: FakeTimer, clock: Clock, gitExecutor: FixedGitExecutor, rootValidator = new FakeRootValidator()) {
  const schedulerFactory = createPortfolioSchedulerRepositoryFactory(fixture.db);
  const runtime = new OperationsRuntime({
    clock,
    timer,
    schedulerFactory,
    // A real repository is required so runtime failure paths cannot use an optional Risk no-op.
    portfolioFactory: { forUser: (userId) => new PortfolioRepository(fixture.db, userId) },
    observationPorts: { projectRootValidator: rootValidator, gitExecutor }
  });
  return { runtime, rootValidator, schedulerFactory };
}

describe("OperationsRuntime", () => {
  it("runs recovery and a 15-second tick using the real observation and reconciliation repository seam", async () => {
    // Arrange
    const fixture = createPortfolioPhase4Fixture();
    const clock = new MutableClock(now);
    const timer = new FakeTimer();
    const gitExecutor = new FakeGitExecutor();
    const { runtime } = createRuntime(fixture, timer, clock, gitExecutor);

    // Act
    await runtime.start();

    // Assert
    assert.deepEqual(timer.periods, [15_000]);
    assert.equal(gitExecutor.calls.length, 0);
    assert.equal(count(fixture.db, "portfolio_evidence", "source_category IN ('platform_lifecycle_v1', 'git_state_v1')"), 0);
  });

  it("caps one multi-tenant tick at 20 total claims rather than 20 per tenant", async () => {
    // Arrange
    const first = createPortfolioPhase4Fixture();
    const second = createPortfolioPhase4Fixture({ db: first.db, ownerEmail: "portfolio-phase5-second-owner@example.com" });
    const clock = new MutableClock(now);
    const timer = new FakeTimer();
    const gitExecutor = new FakeGitExecutor();
    activatePortfolioObservationProfile(first, { canonicalPath: "/canonical/portfolio-phase4", device: 41, inode: 99 }, now);
    // Both fixtures intentionally share the same fake project path, so they share its validated identity too.
    activatePortfolioObservationProfile(second, { canonicalPath: "/canonical/portfolio-phase4", device: 41, inode: 99 }, now);
    addTrackedWakeups(first, 12, "first");
    addTrackedWakeups(second, 12, "second");
    const { runtime } = createRuntime(first, timer, clock, gitExecutor);

    // Act
    await runtime.start();

    // Assert
    assert.equal(count(first.db, "portfolio_reconciliation_runs", "state = 'completed'"), 20);
    assert.equal(count(first.db, "portfolio_reconciliation_runs", "state = 'scheduled'"), 4);
    assert.equal(gitExecutor.calls.length, 20);
    const completedByUser = first.db.prepare(`SELECT user_id, COUNT(*) AS count FROM portfolio_reconciliation_runs
      WHERE state = 'completed' GROUP BY user_id`).all() as Array<{ user_id: string; count: number }>;
    // This topology proves the shared cap, not a general scheduling fairness or no-starvation guarantee.
    assert.deepEqual(completedByUser.map((row) => row.count).sort((left, right) => left - right), [8, 12]);
  });

  it("finalizes a replacement-root failure through the runtime with a durable Risk instead of an optional no-op", async () => {
    // Arrange
    const fixture = createPortfolioPhase4Fixture();
    const clock = new MutableClock(now);
    const timer = new FakeTimer();
    const gitExecutor = new FakeGitExecutor();
    const rootValidator = new FakeRootValidator();
    activatePortfolioObservationProfile(fixture, rootValidator.identity, now);
    rootValidator.identity = { canonicalPath: "/canonical/portfolio-phase4", device: 41, inode: 100 };
    addTrackedWakeups(fixture, 1, "root-replaced");
    const { runtime } = createRuntime(fixture, timer, clock, gitExecutor, rootValidator);

    // Act
    await runtime.start();

    // Assert
    assert.equal(gitExecutor.calls.length, 0);
    assert.equal(count(fixture.db, "portfolio_risk_signals"), 2);
    assert.equal(count(fixture.db, "portfolio_evidence", "source_category IN ('platform_lifecycle_v1', 'git_state_v1') AND freshness = 'failed'"), 2);
  });

  it("clears the timer, aborts the active fake probe, and awaits its tick before shutdown completes", async () => {
    // Arrange
    const fixture = createPortfolioPhase4Fixture();
    const clock = new MutableClock(now);
    const timer = new FakeTimer();
    const events = timer.events;
    const gitExecutor = new BlockingGitExecutor(events);
    const rootValidator = new FakeRootValidator();
    const { runtime } = createRuntime(fixture, timer, clock, gitExecutor, rootValidator);
    await runtime.start();
    activatePortfolioObservationProfile(fixture, rootValidator.identity, now);
    addTrackedWakeups(fixture, 1, "shutdown");

    // Act
    timer.callbacks[0]?.();
    await gitExecutor.started;
    await runtime.stop();
    events.push("stop:resolved");
    timer.callbacks[0]?.();

    // Assert
    assert.equal(timer.cleared.length, 1);
    assert.equal(gitExecutor.calls.length, 1);
    assert.ok(events.indexOf("timer:cleared") < events.indexOf("git:aborted"));
    assert.ok(events.indexOf("git:aborted") < events.indexOf("stop:resolved"));
    assert.equal(count(fixture.db, "portfolio_reconciliation_runs", "state = 'scheduled'"), 0);
  });

  it("keeps Heartbeat disabled by default and creates no command, delivery, model, or probe side effect", async () => {
    // Arrange
    const fixture = createPortfolioPhase4Fixture();
    const clock = new MutableClock(now);
    const timer = new FakeTimer();
    const gitExecutor = new FakeGitExecutor();
    const { runtime, schedulerFactory } = createRuntime(fixture, timer, clock, gitExecutor);
    schedulerFactory.forUser(fixture.owner.id).setHeartbeat({ enabled: false, idempotencyKey: "heartbeat", now });

    // Act
    await runtime.start();

    // Assert
    assert.equal(count(fixture.db, "portfolio_reconciliation_runs", "source = 'heartbeat'"), 0);
    assert.equal(count(fixture.db, "portfolio_commands"), 0);
    assert.equal(count(fixture.db, "portfolio_delivery_records"), 0);
    assert.equal(gitExecutor.calls.length, 0);
  });

  it("reconciles an enabled no-change Heartbeat through bounded ports without commands or deliveries", async () => {
    // Arrange
    const fixture = createPortfolioPhase4Fixture();
    const clock = new MutableClock(now);
    const timer = new FakeTimer();
    const gitExecutor = new FakeGitExecutor();
    activatePortfolioObservationProfile(fixture, { canonicalPath: "/canonical/portfolio-phase4", device: 41, inode: 99 }, now);
    const { runtime, schedulerFactory } = createRuntime(fixture, timer, clock, gitExecutor);
    schedulerFactory.forUser(fixture.owner.id).setHeartbeat({ enabled: true, cadenceMinutes: 5, idempotencyKey: "heartbeat", now });

    // Act
    await runtime.start();

    // Assert
    assert.equal(count(fixture.db, "portfolio_reconciliation_runs", "source = 'heartbeat' AND state = 'completed'"), 1);
    assert.equal(gitExecutor.calls.length, 1);
    assert.equal(count(fixture.db, "portfolio_commands"), 0);
    assert.equal(count(fixture.db, "portfolio_delivery_records"), 0);
  });
});

describe("Gateway OperationsRuntime lifecycle", () => {
  it("provisions an active project root identity and skips a failed root validation without activating a profile", () => {
    // Arrange
    const active = createPortfolioPhase4Fixture();
    const denied = createPortfolioPhase4Fixture();
    const approvedRoot = { canonicalPath: "/canonical/portfolio-phase4", device: 41, inode: 99 };
    const validatedPaths: string[] = [];

    // Act
    const activated = provisionActiveObservationProfiles({
      db: active.db,
      projectRootValidator: {
        validate(projectRoot) {
          validatedPaths.push(projectRoot);
          return approvedRoot;
        }
      }
    });
    const skipped = provisionActiveObservationProfiles({
      db: denied.db,
      projectRootValidator: {
        validate() {
          throw new PortfolioObservationError("PORTFOLIO_OBSERVATION_PROJECT_ROOT_DENIED");
        }
      }
    });

    // Assert
    assert.deepEqual(validatedPaths, ["/tmp/openforge-portfolio-phase4"]);
    assert.deepEqual(activated, { activated: 1, skipped: 0 });
    assert.deepEqual(active.repository.getObservationProfile(active.projectId)?.approvedRoot, approvedRoot);
    assert.deepEqual(skipped, { activated: 0, skipped: 1 });
    assert.equal(denied.repository.getObservationProfile(denied.projectId), undefined);
  });

  it("constructs and starts the profile-ready fake runtime after session recovery, then stops it before database close", async () => {
    // Arrange
    const events: string[] = [];
    const tmuxClient: TmuxClient = {
      async createSession() {},
      async killSession() {},
      async capturePane() { return ""; },
      async listSessions() {
        events.push("session:recovered");
        return [];
      },
      async hasSession() { return false; }
    };
    const gateway = await createGatewayRuntime({
      OPENFORGE_PORT: 30_000,
      OPENFORGE_HOST: "127.0.0.1",
      OPENFORGE_STATE_DIR: "/tmp/openforge-phase5-lifecycle",
      OPENFORGE_DB_PATH: ":memory:",
      OPENFORGE_JWT_SECRET: masterKey,
      OPENFORGE_TMUX_PREFIX: "of-",
      OPENFORGE_PROJECT_MANAGER_AUTO_DISPATCH_ENABLED: false,
      OPENFORGE_MASTER_KEY: masterKey
    }, {
      tmuxClient,
      operationsRuntimeFactory: (dependencies) => {
        assert.equal(dependencies.observationPorts.projectRootValidator.constructor.name, "ApprovedProjectRootValidator");
        events.push("operations:constructed");
        return {
          async recover() {},
          async start() { events.push("operations:started"); },
          async stop() { events.push("operations:stopped"); }
        };
      }
    });
    const database = gateway.app.locals.db as { close(): unknown };
    const close = database.close.bind(database);
    database.close = () => {
      events.push("database:closed");
      return close();
    };

    // Act
    await gateway.recoveryReady;
    await gateway.close();

    // Assert
    assert.deepEqual(events, [
      "session:recovered",
      "operations:constructed",
      "operations:started",
      "operations:stopped",
      "database:closed"
    ]);
  });
});
