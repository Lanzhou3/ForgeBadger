export type ObservationSource = "platform_lifecycle_v1" | "git_state_v1";

export interface ObservationRequest {
  projectId: string;
  source: ObservationSource;
  rootRef: "project_root";
  argumentsJson: Record<string, never>;
}

export interface ApprovedProjectRootIdentity {
  canonicalPath: string;
  device: number;
  inode: number;
}

export interface ObservationDraft {
  projectId: string;
  source: ObservationSource;
  observedAt: Date;
  collectedAt: Date;
  digest: string;
  redactedSummary: string;
  freshness: "fresh" | "timeout" | "failed";
  errorCode?: string;
}

export const OBSERVATION_TIMEOUT_MS = 5_000;
export const OBSERVATION_MAX_CAPTURE_BYTES = 16 * 1024;
export const OBSERVATION_MAX_SUMMARY_CHARS = 1_024;

const observationSources = new Set<ObservationSource>(["platform_lifecycle_v1", "git_state_v1"]);
const mutableCommandFields = new Set([
  "command", "executable", "argv", "args", "cwd", "workingDirectory",
  "model", "modelSuggestion", "skill", "connector", "payload"
]);

export class PortfolioObservationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PortfolioObservationError";
  }
}

/** Validates the entire V1 declaration, not just the fields a caller uses. */
export function validateObservationRequest(input: Record<string, unknown>): ObservationRequest {
  for (const key of Object.keys(input)) {
    if (mutableCommandFields.has(key) || !["projectId", "source", "rootRef", "argumentsJson"].includes(key)) {
      throw new PortfolioObservationError("PORTFOLIO_OBSERVATION_MUTABLE_COMMAND_REJECTED");
    }
  }
  if (typeof input.projectId !== "string" || !input.projectId.trim()) {
    throw new PortfolioObservationError("PORTFOLIO_OBSERVATION_PROJECT_REQUIRED");
  }
  if (typeof input.source !== "string" || !observationSources.has(input.source as ObservationSource)) {
    throw new PortfolioObservationError("PORTFOLIO_OBSERVATION_SOURCE_UNSUPPORTED");
  }
  if (input.rootRef !== "project_root") {
    throw new PortfolioObservationError("PORTFOLIO_OBSERVATION_ROOT_REF_INVALID");
  }
  if (!isEmptyRecord(input.argumentsJson)) {
    throw new PortfolioObservationError("PORTFOLIO_OBSERVATION_ARGUMENTS_INVALID");
  }
  return {
    projectId: input.projectId,
    source: input.source as ObservationSource,
    rootRef: "project_root",
    argumentsJson: {}
  };
}

export function observationFreshnessMs(source: ObservationSource): number {
  return source === "platform_lifecycle_v1" ? 5 * 60_000 : 15 * 60_000;
}

function isEmptyRecord(value: unknown): value is Record<string, never> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}
