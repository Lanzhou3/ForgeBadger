"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cloneElement, isValidElement, useId, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import type { TranslationKey } from "@/lib/i18n";

export const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50";
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const fallbackId = useId();
  const control = isValidElement<{ id?: string }>(children) ? children : null;
  const id = control?.props.id ?? fallbackId;
  return (
    <div className="grid gap-1.5 text-sm">
      <label htmlFor={id} className="text-muted-foreground">
        {label}
      </label>
      {control ? cloneElement(control, { id }) : children}
    </div>
  );
}
export function Panel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}
export function ErrorNotice({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const { t } = useLanguage();
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  const messages: Record<string, TranslationKey> = {
    ARTIFACT_LINK_STALE: "task.artifactStale",
    SESSION_SERVER_UPGRADE_REQUIRED: "workspace.runtimeUpgrade",
    WORKSPACE_COMMIT_CHANGED: "workspace.errorStale",
    CURRENT_VERIFICATION_REQUIRED: "delivery.currentReceipt",
    COMMIT_CHANGES_BEFORE_PULL_REQUEST: "workspace.dirty",
    PULL_REQUEST_BRANCH_MISMATCH: "delivery.headMismatch",
    REMOTE_HEAD_MISMATCH: "delivery.headMismatch",
    REMOTE_BASE_MISMATCH: "delivery.baseMismatch",
    GITHUB_REQUEST_REJECTED: "delivery.prRejected",
    GITHUB_INVALID_RESPONSE: "delivery.prMismatch",
    GITHUB_PULL_REQUEST_MISMATCH: "delivery.prMismatch",
    GITHUB_PULL_REQUEST_AMBIGUOUS: "delivery.prMismatch",
    SECURE_GITHUB_CREDENTIAL_TRANSPORT_REQUIRED: "delivery.secure",
    GITHUB_RESPONSE_UNCERTAIN: "delivery.prUncertain",
    GITHUB_REQUEST_PENDING: "delivery.prUncertain",
    TEAM_CAPABILITY_DENIED: "teams.denied",
    TEAM_MEMBER_REQUIRED: "teams.denied",
    VERIFICATION_RUNNER_PLATFORM_UNSUPPORTED: "workspace.errorPlatform",
    VERIFICATION_RUNTIME_UNRESOLVED: "workspace.errorUnresolved",
    DELIVERY_OPERATION_IN_PROGRESS: "workspace.errorWait",
    VERIFICATION_ALREADY_RUNNING: "workspace.errorWait",
    DELIVERY_RECOVERY_REQUIRED: "workspace.errorRecovery",
    VERIFICATION_PROCESS_RECOVERY_REQUIRED: "workspace.errorProcessRecovery",
    EXECUTION_STOP_PENDING: "workspace.errorStopPending",
    STOP_SOURCE_CLI_BEFORE_DELIVERY: "workspace.stopSourceCli",
    STOP_CLI_BEFORE_VERIFICATION_OR_DELIVERY: "workspace.stopCliHint",
    HOST_EXECUTION_NOT_ENABLED: "workspace.noExecution",
    VERIFICATION_COMMAND_NOT_CONFIGURED: "workspace.noVerification",
    TASK_ACCEPTANCE_CRITERIA_REQUIRED: "workspace.criteriaRequired",
    TASK_ASSIGNED_TO_ANOTHER_MEMBER: "workspace.assignedElsewhere",
    ASSIGNED_REVIEWER_REQUIRED: "workspace.assignedReviewer",
    INDEPENDENT_REVIEWER_REQUIRED: "workspace.reviewHint",
    STALE_TASK_REVISION: "workspace.errorStale",
    STALE_PROJECT_REVISION: "workspace.errorStale",
    STALE_VERIFICATION_OR_TASK: "workspace.errorStale",
    STALE_ACCEPTANCE: "workspace.errorStale",
    COMMIT_CHANGES_BEFORE_VERIFICATION: "workspace.dirty",
    PROJECT_CAPABILITY_DENIED: "workspace.errorAccess",
    PRIVATE_EXECUTION_OWNER_REQUIRED: "workspace.errorAccess",
    EXECUTION_REVOKED: "workspace.errorAccess",
    REVOKE_ACTIVE_EXECUTION_BEFORE_ROLE_CHANGE: "workspace.errorMemberRole",
    WORKSPACE_UNAVAILABLE: "workspace.unavailable",
  };
  return (
    <div
      role="alert"
      className="space-y-2 rounded-md border border-destructive/40 p-3 text-sm"
    >
      <p>{t("workspace.error")}</p>
      <p className="break-words text-muted-foreground">
        {messages[message] ? t(messages[message]) : message}
      </p>
      {retry && (
        <Button size="sm" variant="outline" onClick={retry}>
          {t("workspace.retry")}
        </Button>
      )}
    </div>
  );
}
export function useWorkspaceAction(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (operation: () => Promise<unknown>) => operation(),
    retry: false,
    onSuccess: async () => {
      await client.invalidateQueries({queryKey: ["project-manager", projectId]});
      await client.invalidateQueries({
        queryKey: ["collaboration", projectId],
      });
      await client.invalidateQueries({
        queryKey: ["collaboration", "projects"],
      });
      await client.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
  });
}
export function WorkspaceStatus({ value }: { value: string }) {
  const { t } = useLanguage();
  const known: Record<string, TranslationKey> = {
    owner: "workspace.owner",
    admin: "teams.admin",
    developer: "workspace.developer",
    reviewer: "workspace.reviewer",
    viewer: "workspace.viewer",
    provisioning: "workspace.provisioning",
    ready: "workspace.ready",
    failed: "workspace.failed",
    revoking: "workspace.revoking",
    closed: "workspace.closed",
    integrated: "workspace.integrated",
    running: "workspace.running",
    passed: "workspace.passed",
    unknown: "workspace.unknown",
    accepted: "workspace.accepted",
    changes_requested: "workspace.changes_requested",
    todo: "workspace.todo",
    in_progress: "workspace.in_progress",
    blocked: "workspace.blocked",
    ready_for_review: "workspace.ready_for_review",
    done: "workspace.done",
    cancelled: "workspace.cancelled",
    active: "workspace.active",
    revoked: "workspace.revokedState",
  };
  return (
    <span className="inline-flex rounded border border-border/70 px-1.5 py-0.5 text-xs text-muted-foreground">
      {known[value] ? t(known[value]) : value}
    </span>
  );
}
