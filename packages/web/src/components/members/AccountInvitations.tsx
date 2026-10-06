"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLanguage, useUiLocale } from "@/hooks/use-language";
import { accountsApi, type AccountInvitation } from "@/lib/teams-api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAdminCopy } from "@/components/settings/admin-copy";
import {
  Panel,
  TeamError,
  TeamBadge,
  useTeamAction,
} from "@/components/teams/TeamShared";
export function AccountInvitations({ actorId }: { actorId: string }) {
  const { t } = useLanguage();
  const locale = useUiLocale();
  const adminCopy = useAdminCopy();
  const [invite, setInvite] = useState<AccountInvitation | null>(null);
  const [revoking, setRevoking] = useState<AccountInvitation | null>(null);
  const action = useTeamAction();
  const copy = useMutation({
    mutationFn: (value: string) => navigator.clipboard.writeText(value),
  });
  const query = useQuery({
    queryKey: ["admin-users", "invitations", actorId],
    queryFn: accountsApi.invitations,
  });
  return (
    <Panel title={t("teams.accountInvites")}>
      <p className="text-sm text-muted-foreground">
        {t("teams.accountInviteHint")}
      </p>
      <Button
        size="sm"
        disabled={action.isPending}
        onClick={() =>
          action.mutate(async () =>
            setInvite((await accountsApi.invite()).invite),
          )
        }
      >
        {t("teams.invite")}
      </Button>
      {invite && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              aria-label={t("teams.inviteCode")}
              className="min-w-0 flex-1 rounded-md border border-input bg-background p-2 text-xs"
              value={invite.code}
              readOnly
              onFocus={(e) => e.target.select()}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={copy.isPending}
              onClick={() => copy.mutate(invite.code)}
            >
              {copy.isSuccess ? adminCopy.inviteCodeCopied : adminCopy.copyInviteCode}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("teams.expires")}: {new Date(invite.expiresAt).toLocaleString(locale)}
          </p>
          {copy.isError && (
            <p role="alert" className="text-xs">
              {t("teams.copyFailed")}
            </p>
          )}
        </div>
      )}
      <TeamError error={action.error} />
      {query.isLoading ? (
        <p role="status">{t("common.loading")}</p>
      ) : query.isError ? (
        <TeamError error={query.error} retry={() => void query.refetch()} />
      ) : query.data?.invites.length ? (
        <ul className="divide-y divide-border/70">
          {query.data.invites.map((i) => (
            <li
              className="flex flex-wrap items-center justify-between gap-2 py-3"
              key={i.id}
            >
              <div className="min-w-0 space-y-1">
                <code className="break-all text-xs">{i.code}</code>
                <p>
                  <TeamBadge
                    value={
                      i.usedAt
                        ? "used"
                        : Date.parse(i.expiresAt) <= Date.now()
                          ? "expired"
                          : "pending"
                    }
                  />
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("teams.expires")}: {new Date(i.expiresAt).toLocaleString(locale)}
                </p>
              </div>
              {!i.usedAt && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() => setRevoking(i)}
                >
                  {t("teams.revoke")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">{t("teams.noInvites")}</p>
      )}

      <ConfirmDialog
        open={revoking !== null}
        destructive
        pending={action.isPending}
        title={adminCopy.revokeInviteConfirmTitle}
        description={
          revoking
            ? adminCopy.revokeInviteConfirmDescription.replace("{code}", revoking.code)
            : ""
        }
        confirmLabel={t("teams.revoke")}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        onConfirm={() => {
          const target = revoking;
          setRevoking(null);
          if (target) {
            void action.mutate(async () => {
              await accountsApi.revoke(target.id);
              if (invite?.code === target.code) setInvite(null);
            });
          }
        }}
      />
    </Panel>
  );
}
