import type { WorktreeBranchPrefix } from "./runtime-types.js";

/** The only branch namespaces ForgeBadger creates for managed worktrees. */
export const WORKTREE_BRANCH_PREFIXES: readonly WorktreeBranchPrefix[] = ["codex/task-", "forgebadger/goal-"];
