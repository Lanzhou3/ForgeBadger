"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, MonitorSmartphone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useLanguage } from "@/hooks/use-language";
import { logout } from "@/lib/auth";
import {
  changePassword,
  listAuthSessions,
  revokeAuthSession,
  revokeOtherAuthSessions,
  type AuthSessionSummary,
} from "@/lib/api";

interface PasswordFormState {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const EMPTY_PASSWORD_FORM: PasswordFormState = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

export function AccountSecuritySettings() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [passwordForm, setPasswordForm] = useState<PasswordFormState>(EMPTY_PASSWORD_FORM);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);

  const {
    data: sessionData,
    isLoading: sessionsLoading,
    isError: sessionsError,
  } = useQuery({
    queryKey: ["auth-sessions"],
    queryFn: listAuthSessions,
  });

  const changePasswordMutation = useMutation({
    mutationFn: () =>
      changePassword(passwordForm.currentPassword, passwordForm.newPassword),
    onSuccess: () => {
      // Every session (including this one) is revoked server-side, so the
      // console must drop its local credentials and return to the login page.
      setPasswordForm(EMPTY_PASSWORD_FORM);
      setPasswordError(null);
      setPasswordNotice(t("settings.account.passwordChanged"));
      logout();
      setTimeout(() => {
        window.location.href = "/login";
      }, 1200);
    },
    onError: (error: Error) => {
      setPasswordError(error.message || t("settings.account.passwordChangeFailed"));
    },
  });

  const revokeSessionMutation = useMutation({
    mutationFn: (id: string) => revokeAuthSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
    },
  });

  const revokeOthersMutation = useMutation({
    mutationFn: revokeOtherAuthSessions,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
    },
  });

  const sessions = sessionData?.sessions ?? [];
  const otherSessionCount = useMemo(
    () => sessions.filter((session) => !session.current).length,
    [sessions]
  );

  function submitPasswordChange() {
    setPasswordError(null);
    setPasswordNotice(null);
    if (passwordForm.newPassword.length < 8) {
      setPasswordError(t("settings.account.passwordTooShort"));
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError(t("settings.account.passwordMismatch"));
      return;
    }
    changePasswordMutation.mutate();
  }

  return (
    <Card className="forgebadger-animate-in">
      <CardHeader className="flex flex-row items-center gap-3 space-y-0">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
          <KeyRound className="size-4" />
        </div>
        <div className="min-w-0">
          <CardTitle className="text-sm font-semibold">
            {t("settings.account.title")}
          </CardTitle>
          <CardDescription className="mt-1 text-xs">
            {t("settings.account.description")}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="current-password" className="text-xs font-medium">
              {t("settings.account.currentPassword")}
            </Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={passwordForm.currentPassword}
              onChange={(event) =>
                setPasswordForm((prev) => ({
                  ...prev,
                  currentPassword: event.target.value,
                }))
              }
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-password" className="text-xs font-medium">
                {t("settings.account.newPassword")}
              </Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={passwordForm.newPassword}
                onChange={(event) =>
                  setPasswordForm((prev) => ({
                    ...prev,
                    newPassword: event.target.value,
                  }))
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm-password" className="text-xs font-medium">
                {t("settings.account.confirmPassword")}
              </Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={passwordForm.confirmPassword}
                onChange={(event) =>
                  setPasswordForm((prev) => ({
                    ...prev,
                    confirmPassword: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          {passwordError && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {passwordError}
            </p>
          )}
          {passwordNotice && (
            <p className="rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-400">
              {passwordNotice}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {t("settings.account.passwordHint")}
            </p>
            <Button
              type="button"
              size="sm"
              className="bg-brand text-brand-foreground hover:bg-brand/90"
              disabled={
                changePasswordMutation.isPending ||
                !passwordForm.currentPassword ||
                !passwordForm.newPassword ||
                !passwordForm.confirmPassword
              }
              onClick={submitPasswordChange}
            >
              {changePasswordMutation.isPending
                ? t("settings.account.passwordChanging")
                : t("settings.account.passwordSubmit")}
            </Button>
          </div>
        </div>

        <div className="space-y-3 border-t border-border/70 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <MonitorSmartphone className="size-4 text-muted-foreground" />
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {t("settings.account.devicesTitle")}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {t("settings.account.devicesDescription")}
                </div>
              </div>
            </div>
            {otherSessionCount > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={revokeOthersMutation.isPending}
                onClick={() => revokeOthersMutation.mutate()}
              >
                <LogOut className="size-3.5" />
                {revokeOthersMutation.isPending
                  ? t("settings.account.revoking")
                  : t("settings.account.revokeOthers")}
              </Button>
            )}
          </div>
          {sessionsLoading ? (
            <p className="text-xs text-muted-foreground">
              {t("settings.account.devicesLoading")}
            </p>
          ) : sessionsError ? (
            <p className="text-xs text-destructive">
              {t("settings.account.devicesLoadFailed")}
            </p>
          ) : sessions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("settings.account.devicesEmpty")}
            </p>
          ) : (
            <div className="divide-y divide-border/70 overflow-hidden rounded-md border border-border/70">
              {sessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  revoking={revokeSessionMutation.isPending}
                  onRevoke={() => revokeSessionMutation.mutate(session.id)}
                />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SessionRow({
  session,
  revoking,
  onRevoke,
}: {
  session: AuthSessionSummary;
  revoking: boolean;
  onRevoke: () => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {summarizeUserAgent(session.userAgent) ||
              t("settings.account.unknownDevice")}
          </span>
          {session.current && <Badge>{t("settings.account.currentDevice")}</Badge>}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {t("settings.account.lastActive")}:{" "}
          {new Date(session.lastSeenAt).toLocaleString()}
          {" · "}
          {t("settings.account.signedInAt")}:{" "}
          {new Date(session.createdAt).toLocaleString()}
        </div>
      </div>
      {!session.current && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={revoking}
          onClick={onRevoke}
        >
          {revoking ? t("settings.account.revoking") : t("settings.account.revoke")}
        </Button>
      )}
    </div>
  );
}

/** Collapses a raw User-Agent string to a human-readable device label. */
function summarizeUserAgent(userAgent: string | null): string {
  if (!userAgent) return "";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Chrome\//.test(userAgent)
      ? "Chrome"
      : /Safari\//.test(userAgent)
        ? "Safari"
        : /Firefox\//.test(userAgent)
          ? "Firefox"
          : "";
  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /Mac OS X/.test(userAgent)
      ? "macOS"
      : /Linux/.test(userAgent)
        ? "Linux"
        : /Android/.test(userAgent)
          ? "Android"
          : /iPhone|iPad/.test(userAgent)
            ? "iOS"
            : "";
  return [os, browser].filter(Boolean).join(" · ");
}
