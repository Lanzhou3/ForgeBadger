"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "@/hooks/use-language";
import { Button } from "@/components/ui/button";
import type { TranslationKey } from "@/lib/i18n";
export {
  Field,
  Panel,
  inputClass,
} from "@/components/workspaces/WorkspaceShared";
export function TeamError({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const { t } = useLanguage();
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  const keys: Record<string, TranslationKey> = {
    TEAM_HANDOFF_TARGET_CHANGED: "teams.targetChanged",
    STALE_PLAN_REVISION:"teams.stale",
    TEAM_INVITATION_INVALID: "teams.invalidInvite",
    TEAM_INVITATION_EMAIL_MISMATCH: "teams.emailMismatch",
    REGISTRATION_DISABLED: "teams.registrationOff",
    TEAM_CAPABILITY_DENIED: "teams.denied",
    TEAM_NOT_FOUND: "teams.notFound",
    TEAM_OWNER_TRANSFER_REQUIRED: "teams.ownerRequired",
    TEAM_LAST_ADMIN_REQUIRED: "teams.ownerRequired",
    TEAM_HAS_ACTIVE_PROJECTS: "teams.closeHint",
    TEAM_PROJECT_HAS_EXTERNAL_MEMBERS: "teams.externalMembers",
    TEAM_PROJECT_EXECUTION_ACTIVE: "teams.stopPending",
    TEAM_STOP_PENDING: "teams.stopPending",
    VERIFICATION_RUNTIME_UNRESOLVED: "teams.locked",
    DELIVERY_OPERATION_IN_PROGRESS: "teams.locked",
    STALE_TEAM_REVISION: "teams.stale",
    STALE_MEMBER_REVISION: "teams.stale",
    STALE_PROJECT_REVISION: "teams.stale",
    TEAM_OFFBOARDING_PLAN_STALE: "teams.stale",
    TEAM_OFFBOARDING_PLAN_EXPIRED: "teams.stale",
  };
  return (
    <div
      role="alert"
      className="space-y-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive"
    >
      <p>{t(keys[message] ?? "teams.error")}</p>
      {retry && (
        <Button variant="outline" size="sm" onClick={retry}>
          {t("teams.retry")}
        </Button>
      )}
    </div>
  );
}
export function useTeamAction(_teamId?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (operation: () => Promise<unknown>) => operation(),
    retry: false,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["teams"] }),
        client.invalidateQueries({ queryKey: ["collaboration"] }),
        client.invalidateQueries({ queryKey: ["admin-users"] }),
      ]);
    },
  });
}
export function TeamBadge({ value }: { value: string }) {
  const { t } = useLanguage();
  const keys: Record<string, TranslationKey> = {
    owner: "teams.owner",
    admin: "teams.admin",
    member: "teams.member",
    active: "teams.active",
    leaving: "teams.leaving",
    left: "teams.left",
    pending: "teams.pending",
    used: "teams.used",
    revoked: "teams.revoked",
    expired: "teams.expired",
    closed: "teams.closed",
    closing: "teams.closing",
  };
  return (
    <span className="inline-block rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
      {keys[value] ? t(keys[value]) : value}
    </span>
  );
}
export function CopyLink({ value }: { value: string }) {
  const { t } = useLanguage();
  const action = useMutation({
    mutationFn: () => navigator.clipboard.writeText(value),
  });
  return (
    <div className="space-y-2">
      <input
        className="w-full rounded-md border border-input bg-background p-2 text-xs"
        aria-label={t("teams.copy")}
        readOnly
        value={value}
        onFocus={(e) => e.target.select()}
      />
      <Button size="sm" variant="outline" onClick={() => action.mutate()}>
        {t(action.isSuccess ? "teams.copied" : "teams.copy")}
      </Button>
      {action.isError && (
        <p role="alert" className="text-xs">
          {t("teams.copyFailed")}
        </p>
      )}
    </div>
  );
}
