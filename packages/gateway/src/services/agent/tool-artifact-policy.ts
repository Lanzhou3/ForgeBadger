/** Explicit built-in read snapshots only. Never extend this to terminal history or external tools. */
export const ARCHIVABLE_TOOLS = new Set(['get_project',
  'list_project_files', 'read_project_file', 'search_project_files', 'read_project_diff']);
export const FILE_ARTIFACT_TOOLS = new Set(['list_project_files', 'read_project_file', 'search_project_files', 'read_project_diff']);
export const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
export const MAX_RUN_ARTIFACT_BYTES = 16 * 1024 * 1024;
export const MAX_USER_ARTIFACT_BYTES = 64 * 1024 * 1024;
export const ARTIFACT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
