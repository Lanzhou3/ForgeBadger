export interface ProvisionWorktreeInput {
  sourcePath: string;
  workspacesRoot: string;
  runId: string;
  baseCommit?: string;
  mergeCommit?: string;
  authorize?: () => void;
}
export interface ProvisionedWorktree {
  path: string;
  branch: string;
  baseCommit: string;
  targetBranch: string;
}
export interface InspectedWorktree {
  commit: string;
  dirty: boolean;
  conflicts: string[];
  files: Array<{ path: string; status: string }>;
}
export interface IntegrateWorktreeInput {
  sourcePath: string;
  path: string;
  baseCommit: string;
  expectedCommit: string;
  targetBranch: string;
  authorize?: () => void;
}
export interface VerificationProcessResult {
  exitCode: number | null;
  summary: string;
  status: "passed" | "failed" | "unknown";
}

export interface VerificationRuntimeStatus {
  status: "none" | "running" | "stopped" | "unknown";
  safeToProceed: boolean;
  identity?: string;
  result?: VerificationProcessResult;
}
