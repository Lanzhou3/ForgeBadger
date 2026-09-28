"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLanguage } from "@/hooks/use-language";
import { accountsApi } from "@/lib/teams-api";
import { Button } from "@/components/ui/button";
import { Field, inputClass, TeamError } from "@/components/teams/TeamShared";
export function ResetAccountPassword({
  userId,
  email,
  isSelf,
  onSelfReset,
}: {
  userId: string;
  email: string;
  isSelf: boolean;
  onSelfReset: () => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [ack, setAck] = useState(false);
  const action = useMutation({
    mutationFn: () => accountsApi.reset(userId, password),
    retry: false,
    onSuccess: () => {
      setPassword("");
      setConfirm("");
      setOpen(false);
      setAck(false);
      if (isSelf) onSelfReset();
    },
  });
  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t("teams.reset")}
      </Button>
      {open && (
        <form
          className="space-y-3 rounded-md border border-border/70 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (ack && password === confirm) action.mutate();
          }}
        >
          <p className="break-all text-sm font-medium">{email}</p>
          <p className="text-xs text-muted-foreground">
            {t("teams.resetHint")}
          </p>
          <Field label={t("auth.newPassword")}>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label={t("auth.confirmNewPassword")}>
            <input
              type="password"
              autoComplete="new-password"
              required
              className={inputClass}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          {confirm && confirm !== password && (
            <p role="alert" className="text-sm text-destructive">
              {t("auth.passwordsDoNotMatch")}
            </p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            {t("teams.confirm")}
          </label>
          <div className="flex gap-2">
            <Button
              disabled={
                action.isPending ||
                password.length < 8 ||
                password !== confirm ||
                !ack
              }
            >
              {t("teams.reset")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={action.isPending}
              onClick={() => {
                setOpen(false);
                setPassword("");
                setConfirm("");
                setAck(false);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      )}
      {action.isSuccess && (
        <p role="status" className="text-sm">
          {t("teams.resetDone")}
        </p>
      )}
      <TeamError error={action.error} />
    </div>
  );
}
