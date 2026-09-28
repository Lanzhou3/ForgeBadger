"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { setToken, setUser } from "@/lib/auth";
import {
  captureTeamInvitation,
  clearTeamInvitation,
} from "@/lib/auth-navigation";
import { teamsApi, type InvitationPreview } from "@/lib/teams-api";
import { Button } from "@/components/ui/button";
import { Field, Panel, inputClass, TeamError, TeamBadge } from "./TeamShared";
export function JoinTeam() {
  const { t } = useLanguage();
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const client = useQueryClient();
  const [token, saveToken] = useState<string | null>(null);
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const inspect = useMutation({
    mutationFn: teamsApi.inspect,
    onSuccess: (r) => setPreview(r.invitation),
  });
  const action = useMutation({
    mutationFn: async (register: boolean) => {
      if (!token) return;
      let teamId: string;
      if (register) {
        const result = await teamsApi.register(token, email.trim(), password);
        setToken(result.token);
        setUser(result.user);
        client.clear();
        client.setQueryData(["auth", "me"], result.user);
        teamId = result.team.id;
      } else {
        teamId = (await teamsApi.accept(token)).team.id;
      }
      clearTeamInvitation();
      router.replace("/members?team=" + encodeURIComponent(teamId));
    },
    retry: false,
  });
  const inspectToken = inspect.mutate;
  useEffect(() => {
    const current = captureTeamInvitation();
    saveToken(current);
    if (current)
      inspectToken(
        current,
      ); /* The secret is held outside query keys and URLs. */
  }, [inspectToken]);
  return (
    <main className="mx-auto max-w-xl space-y-5 p-6 pt-12">
      <h1 className="text-xl font-semibold">{t("teams.join")}</h1>
      <p className="text-sm text-muted-foreground">{t("teams.joinIntro")}</p>
      {token === null || inspect.isPending || isLoading ? (
        <p role="status">{t("common.loading")}</p>
      ) : !token ? (
        <p>{t("teams.missingInvite")}</p>
      ) : inspect.isError ? (
        <TeamError error={inspect.error} retry={() => inspect.mutate(token)} />
      ) : (
        preview && (
          <Panel title={preview.teamName}>
            <p className="text-sm">{preview.emailHint}</p>
            <TeamBadge value={preview.role} />
            <p className="text-xs text-muted-foreground">
              {t("teams.expires")}:{" "}
              {new Date(preview.expiresAt).toLocaleString()}
            </p>
            {user ? (
              <>
                <p className="text-sm">
                  {t("teams.signedIn")}: {user.email}
                </p>
                <Button
                  disabled={action.isPending}
                  onClick={() => action.mutate(false)}
                >
                  {t("teams.join")}
                </Button>
                <Button asChild variant="ghost">
                  <Link href="/login?next=%2Fjoin" referrerPolicy="no-referrer">
                    {t("teams.switchAccount")}
                  </Link>
                </Button>
              </>
            ) : (
              <>
                <Button asChild variant="outline">
                  <Link href="/login?next=%2Fjoin" referrerPolicy="no-referrer">
                    {t("teams.signInJoin")}
                  </Link>
                </Button>
                {preview.registrationAllowed ? (
                  <form
                    className="space-y-3 border-t border-border pt-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (password === confirm) action.mutate(true);
                    }}
                  >
                    <Field label={t("auth.email")}>
                      <input
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        className={inputClass}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </Field>
                    <Field label={t("auth.password")}>
                      <input
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={8}
                        value={password}
                        className={inputClass}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </Field>
                    <Field label={t("auth.confirmPassword")}>
                      <input
                        type="password"
                        autoComplete="new-password"
                        required
                        value={confirm}
                        className={inputClass}
                        onChange={(e) => setConfirm(e.target.value)}
                      />
                    </Field>
                    {confirm && password !== confirm && (
                      <p role="alert" className="text-sm text-destructive">
                        {t("auth.passwordsDoNotMatch")}
                      </p>
                    )}
                    <Button disabled={action.isPending || password !== confirm}>
                      {t("teams.registerJoin")}
                    </Button>
                  </form>
                ) : (
                  <p className="text-sm">{t("teams.registrationOff")}</p>
                )}
              </>
            )}
            <TeamError error={action.error} />
          </Panel>
        )
      )}
      {token && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            clearTeamInvitation();
            saveToken("");
            setPreview(null);
          }}
        >
          {t("teams.forgetInvite")}
        </Button>
      )}
    </main>
  );
}
