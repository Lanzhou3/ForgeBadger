"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLanguage } from "@/hooks/use-language";
import { accountsApi } from "@/lib/teams-api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAdminCopy } from "@/components/settings/admin-copy";
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
  const adminCopy = useAdminCopy();
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

  function closeDialog() {
    setOpen(false);
    setPassword("");
    setConfirm("");
    setAck(false);
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t("teams.reset")}
      </Button>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : closeDialog())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">{t("teams.reset")}</DialogTitle>
            <DialogDescription>
              <span className="break-all font-medium text-foreground">{email}</span>
              {" · "}
              {t("teams.resetHint")}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (ack && password === confirm) action.mutate();
            }}
          >
            <div className="space-y-3">
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
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-brand"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />
                {adminCopy.resetPasswordAck(email)}
              </label>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={action.isPending} onClick={closeDialog}>
                {t("common.cancel")}
              </Button>
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
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {action.isSuccess && (
        <p role="status" className="text-sm">
          {t("teams.resetDone")}
        </p>
      )}
      <TeamError error={action.error} />
    </div>
  );
}
