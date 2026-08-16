import { digestPortfolioValue } from "../../db/repositories/portfolio-repository.js";
import {
  OBSERVATION_MAX_CAPTURE_BYTES,
  OBSERVATION_MAX_SUMMARY_CHARS,
  OBSERVATION_TIMEOUT_MS,
  PortfolioObservationError,
  type ApprovedProjectRootIdentity,
  type ObservationDraft,
  type ObservationRequest,
  type ObservationSource,
  validateObservationRequest
} from "./observation-contract.js";
import type { FixedGitExecutor } from "./git-state-probe.js";

export type { FixedGitExecutor } from "./git-state-probe.js";
export type { ApprovedProjectRootIdentity, ObservationDraft, ObservationRequest, ObservationSource } from "./observation-contract.js";

export interface Clock {
  now(): Date;
}

export interface ProjectRootValidator {
  validate(projectRoot: string): ApprovedProjectRootIdentity;
}

export interface ObservationRepositoryPort {
  getObservationRequest(projectId: string, source: ObservationSource): {
    projectRoot: string;
    active: boolean;
    approvedRoot: ApprovedProjectRootIdentity | null;
  } | undefined;
  readPlatformLifecycleSnapshot(projectId: string): Record<string, unknown>;
  createRiskSignal(input: {
    projectId: string;
    evidenceId?: string;
    workItemId?: string;
    attemptId?: string;
    severity: "low" | "medium" | "high";
    rationale: string;
    idempotencyKey: string;
  }): { id: string; evidenceId: string | null; severity: string; rationale: string; createdAt: Date };
}

export type ObservationCollectionResult = {
  status: "collected" | "failed";
  draft: ObservationDraft;
};

/**
 * Collects a bounded draft only. Persistence is deliberately deferred to the
 * scheduler's claim-CAS transaction, so a lost claim cannot orphan Evidence.
 */
export class ObservationService {
  constructor(private readonly dependencies: {
    clock: Clock;
    projectRootValidator: ProjectRootValidator;
    gitExecutor: FixedGitExecutor;
    repository: ObservationRepositoryPort;
  }) {}

  async collect(input: Record<string, unknown>, signal?: AbortSignal): Promise<ObservationCollectionResult> {
    const request = validateObservationRequest(input);
    const observedAt = this.dependencies.clock.now();
    const config = this.dependencies.repository.getObservationRequest(request.projectId, request.source);
    if (!config?.active || !config.approvedRoot) return this.failure(request, observedAt, "PORTFOLIO_OBSERVATION_PROFILE_INACTIVE");
    const currentRoot = this.revalidateRoot(config.projectRoot);
    if (currentRoot instanceof PortfolioObservationError) return this.failure(request, observedAt, currentRoot.code);
    if (!sameRootIdentity(config.approvedRoot, currentRoot)) {
      return this.failure(request, observedAt, "PORTFOLIO_OBSERVATION_PROJECT_ROOT_REPLACED");
    }
    if (signal?.aborted) return this.failure(request, observedAt, "PORTFOLIO_OBSERVATION_GIT_ABORTED");
    return request.source === "platform_lifecycle_v1"
      ? this.collectPlatform(request, observedAt)
      : this.collectGit(request, currentRoot.canonicalPath, observedAt, signal);
  }

  private revalidateRoot(projectRoot: string): ApprovedProjectRootIdentity | PortfolioObservationError {
    try {
      return this.dependencies.projectRootValidator.validate(projectRoot);
    } catch (error) {
      if (error instanceof PortfolioObservationError) return error;
      return new PortfolioObservationError("PORTFOLIO_OBSERVATION_PROJECT_ROOT_DENIED");
    }
  }

  private collectPlatform(request: ObservationRequest, observedAt: Date): ObservationCollectionResult {
    try {
      const snapshot = this.dependencies.repository.readPlatformLifecycleSnapshot(request.projectId);
      return this.success(request, observedAt, digestPortfolioValue(snapshot), "Platform lifecycle snapshot collected");
    } catch {
      return this.failure(request, observedAt, "PORTFOLIO_OBSERVATION_PLATFORM_SNAPSHOT_FAILED");
    }
  }

  private async collectGit(
    request: ObservationRequest,
    projectRoot: string,
    observedAt: Date,
    signal?: AbortSignal
  ): Promise<ObservationCollectionResult> {
    try {
      const result = await this.dependencies.gitExecutor.execute({
        executable: "git",
        args: ["-C", projectRoot, "status", "--porcelain=v1", "--branch"],
        timeoutMs: OBSERVATION_TIMEOUT_MS,
        maxCombinedOutputBytes: OBSERVATION_MAX_CAPTURE_BYTES,
        ...(signal ? { signal } : {})
      });
      const raw = `${result.stdout}${result.stderr}`;
      if (Buffer.byteLength(raw, "utf8") > OBSERVATION_MAX_CAPTURE_BYTES) {
        return this.failure(request, observedAt, "PORTFOLIO_OBSERVATION_GIT_OUTPUT_LIMIT");
      }
      if (result.exitCode !== 0) return this.failure(request, observedAt, "PORTFOLIO_OBSERVATION_GIT_FAILED");
      return this.success(request, observedAt, digestPortfolioValue(raw), redactGitSummary(raw));
    } catch (error) {
      return this.failure(request, observedAt, observationFailureCode(error));
    }
  }

  private success(request: ObservationRequest, observedAt: Date, digest: string, summary: string): ObservationCollectionResult {
    return {
      status: "collected",
      draft: {
        projectId: request.projectId,
        source: request.source,
        observedAt,
        collectedAt: this.dependencies.clock.now(),
        digest,
        redactedSummary: boundedSummary(summary),
        freshness: "fresh"
      }
    };
  }

  private failure(request: ObservationRequest, observedAt: Date, errorCode: string): ObservationCollectionResult {
    const freshness = errorCode === "PORTFOLIO_OBSERVATION_GIT_TIMEOUT" || errorCode === "PORTFOLIO_OBSERVATION_GIT_ABORTED" ? "timeout" : "failed";
    return {
      status: "failed",
      draft: {
        projectId: request.projectId,
        source: request.source,
        observedAt,
        collectedAt: this.dependencies.clock.now(),
        digest: digestPortfolioValue({ source: request.source, errorCode, observedAt: observedAt.getTime() }),
        redactedSummary: `Observation collection failed: ${errorCode}`,
        freshness,
        errorCode
      }
    };
  }
}

function sameRootIdentity(expected: ApprovedProjectRootIdentity, current: ApprovedProjectRootIdentity): boolean {
  return expected.canonicalPath === current.canonicalPath && expected.device === current.device && expected.inode === current.inode;
}

function observationFailureCode(error: unknown): string {
  if (error instanceof PortfolioObservationError) return error.code;
  return "PORTFOLIO_OBSERVATION_GIT_FAILED";
}

function redactGitSummary(raw: string): string {
  return raw
    .replace(/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g, "[redacted credential material]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{8,})\b/g, "[redacted]")
    .replace(/\b(?:token|secret|password|api[_-]?key)\s*[:=]\s*\S+/gi, "$1: [redacted]")
    .replace(/[\r\n]+/g, " ");
}

function boundedSummary(value: string): string {
  return value.length > OBSERVATION_MAX_SUMMARY_CHARS ? value.slice(0, OBSERVATION_MAX_SUMMARY_CHARS) : value;
}
