import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NodeFixedGitExecutor } from "../src/services/portfolio/git-state-probe.js";
import {
  OBSERVATION_MAX_CAPTURE_BYTES,
  OBSERVATION_MAX_SUMMARY_CHARS,
  OBSERVATION_TIMEOUT_MS,
  observationFreshnessMs,
  PortfolioObservationError,
  validateObservationRequest,
  type ApprovedProjectRootIdentity
} from "../src/services/portfolio/observation-contract.js";
import {
  ObservationService,
  type Clock,
  type FixedGitExecutor,
  type ObservationRepositoryPort,
  type ProjectRootValidator
} from "../src/services/portfolio/observation-service.js";

/** Fixed time keeps collection drafts deterministic and forbids wall-clock leakage. */
class FakeClock implements Clock {
  constructor(private readonly value: Date) {}

  now(): Date {
    return new Date(this.value);
  }
}

class FakeRootValidator implements ProjectRootValidator {
  readonly calls: string[] = [];
  identity: ApprovedProjectRootIdentity = { canonicalPath: "/resolved/project-one", device: 41, inode: 99 };
  failure: Error | undefined;

  validate(projectRoot: string): ApprovedProjectRootIdentity {
    this.calls.push(projectRoot);
    if (this.failure) throw this.failure;
    return this.identity;
  }
}

class FakeGitExecutor implements FixedGitExecutor {
  readonly calls: Parameters<FixedGitExecutor["execute"]>[0][] = [];
  response = { stdout: "## main\n M tracked.ts\n", stderr: "", exitCode: 0 };
  failure: Error | undefined;

  async execute(input: Parameters<FixedGitExecutor["execute"]>[0]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    this.calls.push(input);
    if (this.failure) throw this.failure;
    return this.response;
  }
}

class FakeObservationRepository implements ObservationRepositoryPort {
  readonly profiles = new Map<string, { projectRoot: string; active: boolean; approvedRoot: ApprovedProjectRootIdentity | null }>();
  readonly riskInputs: Parameters<ObservationRepositoryPort["createRiskSignal"]>[0][] = [];
  platformSnapshot: Record<string, unknown> = { lifecycle: "idle" };

  getObservationRequest(projectId: string): { projectRoot: string; active: boolean; approvedRoot: ApprovedProjectRootIdentity | null } | undefined {
    return this.profiles.get(projectId);
  }

  readPlatformLifecycleSnapshot(): Record<string, unknown> {
    return this.platformSnapshot;
  }

  createRiskSignal(input: Parameters<ObservationRepositoryPort["createRiskSignal"]>[0]) {
    this.riskInputs.push(input);
    return { id: `risk:${this.riskInputs.length}`, evidenceId: null, severity: input.severity, rationale: input.rationale, createdAt: new Date(0) };
  }
}

function createFixture() {
  const clock = new FakeClock(new Date("2026-08-15T00:00:00.000Z"));
  const repository = new FakeObservationRepository();
  const rootValidator = new FakeRootValidator();
  const gitExecutor = new FakeGitExecutor();
  const service = new ObservationService({ clock, projectRootValidator: rootValidator, gitExecutor, repository });
  repository.profiles.set("project:one", {
    projectRoot: "/workspace/project-one",
    active: true,
    approvedRoot: { canonicalPath: "/resolved/project-one", device: 41, inode: 99 }
  });
  return { clock, repository, rootValidator, gitExecutor, service };
}

function observationRequest(source: "platform_lifecycle_v1" | "git_state_v1"): Record<string, unknown> {
  return { projectId: "project:one", source, rootRef: "project_root", argumentsJson: {} };
}

function hasErrorCode(error: unknown, expected: string): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === expected;
}

describe("Portfolio observation contract", () => {
  it("accepts only the closed V1 source/root/empty-argument tuple", () => {
    // Arrange
    const valid = observationRequest("git_state_v1");

    // Act
    const parsed = validateObservationRequest(valid);

    // Assert
    assert.deepEqual(parsed, valid);
    assert.throws(() => validateObservationRequest({ ...valid, source: "shell_v1" }), (error) => hasErrorCode(error, "PORTFOLIO_OBSERVATION_SOURCE_UNSUPPORTED"));
    assert.throws(() => validateObservationRequest({ ...valid, rootRef: "caller_path" }), (error) => hasErrorCode(error, "PORTFOLIO_OBSERVATION_ROOT_REF_INVALID"));
    assert.throws(() => validateObservationRequest({ ...valid, argumentsJson: { branch: "main" } }), (error) => hasErrorCode(error, "PORTFOLIO_OBSERVATION_ARGUMENTS_INVALID"));
    assert.throws(() => validateObservationRequest({ ...valid, command: "git log --all" }), (error) => hasErrorCode(error, "PORTFOLIO_OBSERVATION_MUTABLE_COMMAND_REJECTED"));
  });

  it("uses the source-owned timeout, capture cap, summary cap, and freshness windows", () => {
    // Arrange

    // Act
    const platformFreshness = observationFreshnessMs("platform_lifecycle_v1");
    const gitFreshness = observationFreshnessMs("git_state_v1");

    // Assert
    assert.equal(OBSERVATION_TIMEOUT_MS, 5_000);
    assert.equal(OBSERVATION_MAX_CAPTURE_BYTES, 16 * 1024);
    assert.equal(OBSERVATION_MAX_SUMMARY_CHARS, 1_024);
    assert.equal(platformFreshness, 5 * 60_000);
    assert.equal(gitFreshness, 15 * 60_000);
  });
});

describe("ObservationService.collect", () => {
  it("revalidates root device/inode on every run and invokes only the fixed non-shell Git recipe", async () => {
    // Arrange
    const { service, rootValidator, gitExecutor } = createFixture();

    // Act
    const first = await service.collect(observationRequest("git_state_v1"));
    const second = await service.collect(observationRequest("git_state_v1"));

    // Assert
    assert.deepEqual(rootValidator.calls, ["/workspace/project-one", "/workspace/project-one"]);
    assert.equal(first.status, "collected");
    assert.equal(second.status, "collected");
    assert.equal(gitExecutor.calls.length, 2);
    for (const call of gitExecutor.calls) {
      assert.equal(call.executable, "git");
      assert.deepEqual(call.args, ["-C", "/resolved/project-one", "status", "--porcelain=v1", "--branch"]);
      assert.equal(call.timeoutMs, OBSERVATION_TIMEOUT_MS);
      assert.equal(call.maxCombinedOutputBytes, OBSERVATION_MAX_CAPTURE_BYTES);
    }
  });

  it("returns drafts only: platform collection neither starts Git nor persists Evidence or Risk", async () => {
    // Arrange
    const { service, gitExecutor, repository } = createFixture();
    repository.platformSnapshot = { lifecycle: "active", sessions: 3 };

    // Act
    const result = await service.collect(observationRequest("platform_lifecycle_v1"));

    // Assert
    assert.equal(result.status, "collected");
    assert.equal(result.draft.source, "platform_lifecycle_v1");
    assert.equal(gitExecutor.calls.length, 0);
    assert.deepEqual(repository.riskInputs, []);
    assert.equal("evidence" in result, false);
  });

  it("returns an inactive-profile failure draft without probing or creating a Risk", async () => {
    // Arrange
    const { service, repository, gitExecutor } = createFixture();
    repository.profiles.delete("project:one");

    // Act
    const result = await service.collect(observationRequest("git_state_v1"));

    // Assert
    assert.equal(result.status, "failed");
    assert.equal(result.draft.errorCode, "PORTFOLIO_OBSERVATION_PROFILE_INACTIVE");
    assert.equal(gitExecutor.calls.length, 0);
    assert.deepEqual(repository.riskInputs, []);
  });

  it("returns bounded failure drafts for denied and symlink roots, then detects canonical device/inode replacement without Git", async () => {
    // Arrange
    const cases = [
      "PORTFOLIO_OBSERVATION_PROJECT_ROOT_DENIED",
      "PORTFOLIO_OBSERVATION_PROJECT_ROOT_SYMLINK_ESCAPE"
    ] as const;

    for (const code of cases) {
      const { service, rootValidator, gitExecutor } = createFixture();
      rootValidator.failure = new PortfolioObservationError(code);

      // Act
      const result = await service.collect(observationRequest("git_state_v1"));

      // Assert
      assert.equal(result.status, "failed");
      assert.equal(result.draft.errorCode, code);
      assert.equal(gitExecutor.calls.length, 0);
    }
    const replaced = createFixture();
    replaced.rootValidator.identity = { canonicalPath: "/resolved/project-one", device: 41, inode: 100 };

    // Act
    const replacement = await replaced.service.collect(observationRequest("git_state_v1"));

    // Assert
    assert.equal(replacement.status, "failed");
    assert.equal(replacement.draft.errorCode, "PORTFOLIO_OBSERVATION_PROJECT_ROOT_REPLACED");
    assert.equal(replaced.gitExecutor.calls.length, 0);
    assert.ok(replacement.draft.redactedSummary.length <= OBSERVATION_MAX_SUMMARY_CHARS);
  });

  it("converts timeout and abort into explicit drafts without preserving partial raw capture", async () => {
    // Arrange
    const timeoutFixture = createFixture();
    timeoutFixture.gitExecutor.failure = new PortfolioObservationError("PORTFOLIO_OBSERVATION_GIT_TIMEOUT");
    const abortFixture = createFixture();
    const controller = new AbortController();
    controller.abort();

    // Act
    const timeout = await timeoutFixture.service.collect(observationRequest("git_state_v1"));
    const aborted = await abortFixture.service.collect(observationRequest("git_state_v1"), controller.signal);

    // Assert
    assert.equal(timeout.status, "failed");
    assert.equal(timeout.draft.errorCode, "PORTFOLIO_OBSERVATION_GIT_TIMEOUT");
    assert.equal(timeout.draft.freshness, "timeout");
    assert.equal(timeout.draft.redactedSummary.includes("partial stdout"), false);
    assert.equal(aborted.status, "failed");
    assert.equal(aborted.draft.errorCode, "PORTFOLIO_OBSERVATION_GIT_ABORTED");
    assert.equal(abortFixture.gitExecutor.calls.length, 0);
  });

  it("rejects combined stdout/stderr above 16 KiB and never exposes a partial capture", async () => {
    // Arrange
    const { service, gitExecutor } = createFixture();
    gitExecutor.response = { stdout: "x".repeat(OBSERVATION_MAX_CAPTURE_BYTES), stderr: "y", exitCode: 0 };

    // Act
    const result = await service.collect(observationRequest("git_state_v1"));

    // Assert
    assert.equal(result.status, "failed");
    assert.equal(result.draft.errorCode, "PORTFOLIO_OBSERVATION_GIT_OUTPUT_LIMIT");
    assert.equal(result.draft.redactedSummary.includes("x".repeat(64)), false);
    assert.equal("rawOutput" in result.draft, false);
  });

  it("redacts sensitive output and caps the unpersisted summary at 1024 characters", async () => {
    // Arrange
    const { service, gitExecutor } = createFixture();
    gitExecutor.response = { stdout: `api_key=secret-value\n${"changed-file\n".repeat(500)}`, stderr: "", exitCode: 0 };

    // Act
    const result = await service.collect(observationRequest("git_state_v1"));

    // Assert
    assert.equal(result.status, "collected");
    assert.ok(result.draft.redactedSummary.length <= OBSERVATION_MAX_SUMMARY_CHARS);
    assert.equal(result.draft.redactedSummary.includes("secret-value"), false);
    assert.equal("rawOutput" in result.draft, false);
  });
});

describe("NodeFixedGitExecutor", () => {
  it("rejects noncanonical argv before spawning any real Git process", async () => {
    // Arrange
    const executor = new NodeFixedGitExecutor();

    // Act / Assert
    await assert.rejects(
      () => executor.execute({
        executable: "git",
        args: ["-C", "/resolved/project-one", "status", "--short"],
        timeoutMs: OBSERVATION_TIMEOUT_MS,
        maxCombinedOutputBytes: OBSERVATION_MAX_CAPTURE_BYTES
      }),
      (error) => hasErrorCode(error, "PORTFOLIO_OBSERVATION_GIT_COMMAND_INVALID")
    );
  });
});
