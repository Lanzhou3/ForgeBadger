"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "@/hooks/use-language";
import type { TranslationKey } from "@/lib/i18n";
import { ErrorNotice } from "@/components/workspaces/WorkspaceShared";

const hubMessages: Record<string, TranslationKey> = {
  SELF_CONFIRMATION_DENIED: "hub.errorSelf",
  TASK_ASSIGNEE_REQUIRED: "hub.errorAssignee",
  TASK_REVIEWER_REQUIRED: "hub.reviewerOnly",
  SUBMISSION_SUPERSEDED: "hub.errorSuperseded",
  SUBMISSION_STALE: "hub.stale",
  TASK_ALREADY_FINISHED: "hub.errorFinished",
  INVALID_INPUT: "hub.errorInvalid",
  LOCAL_CHANGES_UNCOMMITTED: "hubLink.errUncommitted",
  LOCAL_BRANCH_NOT_PUSHED: "hubLink.errNotPushed",
  SUBMIT_FROM_DEFAULT_BRANCH: "hubLink.errDefaultBranch",
  LOCAL_HEAD_DETACHED: "hubLink.errDetached",
  LOCAL_REPOSITORY_UNAVAILABLE: "hubLink.errRepository",
  HUB_UNREACHABLE: "hubLink.errUnreachable",
  HUB_TOKEN_REJECTED: "hubLink.errToken",
  HUB_TOKEN_INVALID: "hubLink.errToken",
  HUB_URL_HTTPS_REQUIRED: "hubLink.errHttps",
  HUB_URL_INVALID: "hubLink.errUrl",
  HUB_URL_REJECTED: "hubLink.errUrl",
  LOCAL_PROJECT_ALREADY_LINKED: "hubLink.errLinked",
  MODULE_PATTERN_UNKNOWN: "hubInsights.err.MODULE_PATTERN_UNKNOWN",
  HUB_REPOSITORY_NOT_CONFIGURED: "hubInsights.err.HUB_REPOSITORY_NOT_CONFIGURED",
  MIRROR_REMOTE_MISMATCH: "hubInsights.err.MIRROR_REMOTE_MISMATCH",
  MIRROR_FETCH_FAILED: "hubInsights.err.MIRROR_FETCH_FAILED",
  REMOTE_AUTH_REJECTED: "hubInsights.err.REMOTE_AUTH_REJECTED",
  REMOTE_RATE_LIMITED: "hubInsights.err.REMOTE_RATE_LIMITED",
  REMOTE_REPOSITORY_NOT_FOUND: "hubInsights.err.REMOTE_REPOSITORY_NOT_FOUND",
  REMOTE_REPOSITORY_UNSUPPORTED: "hubInsights.err.REMOTE_REPOSITORY_UNSUPPORTED",
  REMOTE_UNREACHABLE: "hubInsights.err.REMOTE_UNREACHABLE",
  REMOTE_RESPONSE_INVALID: "hubInsights.err.REMOTE_RESPONSE_INVALID",
  SECURE_CREDENTIAL_TRANSPORT_REQUIRED: "hubInsights.err.SECURE_CREDENTIAL_TRANSPORT_REQUIRED",
  PROJECT_CAPABILITY_DENIED: "hubInsights.err.PROJECT_CAPABILITY_DENIED",
};

interface HubErrorProps {
  error: unknown;
  retry?: () => void;
}

/** Translates hub error codes; everything else falls through to the shared notice. */
export function HubError({ error, retry }: HubErrorProps) {
  const { t } = useLanguage();
  if (!error) return null;
  const code = error instanceof Error ? error.message : String(error);
  const known = hubMessages[code];
  return <ErrorNotice error={known ? new Error(t(known)) : error} {...(retry ? { retry } : {})} />;
}

/** Runs a hub mutation and refreshes every view that shows the affected task. */
export function useHubAction(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (operation: () => Promise<unknown>) => operation(),
    retry: false,
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: ["hub", projectId] });
      await client.invalidateQueries({ queryKey: ["hub-insights", projectId] });
      await client.invalidateQueries({ queryKey: ["hub", "tokens"] });
      await client.invalidateQueries({ queryKey: ["hub-link"] });
      await client.invalidateQueries({ queryKey: ["project-manager", projectId] });
      await client.invalidateQueries({ queryKey: ["collaboration", projectId] });
    },
  });
}
