export type CredentialMode = "stored_encrypted_key" | "host_environment";

export interface RenderPlan {
  projectId: string;
  targetRoot: string;
  templateId: string;
  variables: Record<string, string>;
  files: GeneratedFile[];
  credentialMode: CredentialMode;
  dryRun: boolean;
}

export interface GeneratedFile {
  relativePath: string;
  content: string;
  mode?: string;
  sha256: string;
  sourceTemplateFileId: string;
}

export interface ConflictLinePreview {
  line: number;
  existing: string;
  incoming: string;
}

export interface ConflictReport {
  relativePath: string;
  existingSha256?: string;
  incomingSha256: string;
  conflictType: "exists" | "modified" | "unsafe_path";
  allowedActions: Array<"skip" | "overwrite">;
  diffPreview?: ConflictLinePreview[];
}

export interface WriteResult {
  writtenFiles: string[];
  skippedFiles: string[];
  backupPath: string;
  conflicts: ConflictReport[];
  /**
   * Final outcome of the write: `applied` for full success, `rolled_back`
   * when a write failed and rollback succeeded, `rollback_failed` when the
   * rollback itself failed and the project may be in a partial state.
   */
  outcome: "applied" | "rolled_back" | "rollback_failed";
  failedFiles: string[];
  rollbackAvailable: boolean;
  rollbackResult?: RollbackResult;
}

export interface RollbackResult {
  restoredFiles: string[];
  removedFiles: string[];
  failedFiles: string[];
  success: boolean;
}

export interface TemplateFileInput {
  id: string;
  relativePath: string;
  content: string;
  mode?: string;
}

export interface CreateRenderPlanInput {
  projectId: string;
  targetRoot: string;
  templateId: string;
  variables: Record<string, string>;
  templateFiles: TemplateFileInput[];
  credentialMode: CredentialMode;
  dryRun: boolean;
}
