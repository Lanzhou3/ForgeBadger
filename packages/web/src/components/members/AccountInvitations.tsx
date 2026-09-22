"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLanguage } from "@/hooks/use-language";
import { accountsApi } from "@/lib/teams-api";
import { Button } from "@/components/ui/button";
import {
  Panel,
  TeamError,
  TeamBadge,
  useTeamAction,
} from "@/components/teams/TeamShared";
export function AccountInvitations({ actorId }: { actorId: string }) {
  const { t } = useLanguage();
  const [code, setCode] = useState("");
  const action = useTeamAction();
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
            setCode((await accountsApi.invite()).invite.code),
          )
        }
      >
        {t("teams.invite")}
      </Button>
      {code && (
        <input
          aria-label={t("teams.inviteCode")}
          className="w-full rounded-md border border-input bg-background p-2 text-xs"
          value={code}
          readOnly
          onFocus={(e) => e.target.select()}
        />
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
                  {t("teams.expires")}: {new Date(i.expiresAt).toLocaleString()}
                </p>
              </div>
              {!i.usedAt && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate(async () => {
                      await accountsApi.revoke(i.id);
                      if (code === i.code) setCode("");
                    })
                  }
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
    </Panel>
  );
}
