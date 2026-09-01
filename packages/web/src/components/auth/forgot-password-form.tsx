"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/hooks/use-language";
import { GatewayApiError, resetPassword } from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";

interface FormData {
  email: string;
  recoveryKey: string;
  newPassword: string;
  confirmPassword: string;
}

export function ForgotPasswordForm() {
  const router = useRouter();
  const { t } = useLanguage();
  const schema = useMemo(() => z.object({
    email: z.string().email(t("auth.emailInvalid")),
    recoveryKey: z.string().min(1, t("auth.recoveryKeyRequired")),
    newPassword: z.string().min(8, t("auth.passwordMinLength")),
    confirmPassword: z.string().min(1, t("auth.confirmPasswordRequired"))
  }).refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: t("auth.passwordsDoNotMatch")
  }), [t]);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    try {
      await resetPassword({
        email: data.email,
        recoveryKey: data.recoveryKey.trim(),
        newPassword: data.newPassword
      });
      router.replace("/login?passwordReset=1");
    } catch (error) {
      setError("root", {
        message: t(resetErrorKey(error))
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="forgebadger-animate-in flex flex-col gap-4">
      <p className="rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
        {t("auth.recoveryInstructions")}
      </p>
      <RecoveryField
        id="email"
        label={t("auth.email")}
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        registration={register("email")}
      />
      <RecoveryField
        id="recoveryKey"
        label={t("auth.recoveryKey")}
        type="password"
        autoComplete="off"
        error={errors.recoveryKey?.message}
        registration={register("recoveryKey")}
      />
      <RecoveryField
        id="newPassword"
        label={t("auth.newPassword")}
        type="password"
        autoComplete="new-password"
        error={errors.newPassword?.message}
        registration={register("newPassword")}
      />
      <RecoveryField
        id="confirmPassword"
        label={t("auth.confirmNewPassword")}
        type="password"
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        registration={register("confirmPassword")}
      />
      {errors.root && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {errors.root.message}
        </p>
      )}
      <Button type="submit" disabled={isSubmitting} className="mt-1 bg-brand text-brand-foreground hover:bg-brand/90">
        {isSubmitting ? t("auth.resetting") : t("auth.resetPassword")}
      </Button>
      <p className="text-xs text-muted-foreground">
        {t("auth.resetCompleteHint")}{" "}
        <Link href="/login" className="font-medium text-brand underline-offset-4 hover:underline">
          {t("auth.backToSignIn")}
        </Link>
      </p>
    </form>
  );
}

function resetErrorKey(error: unknown): TranslationKey {
  if (!(error instanceof GatewayApiError)) return "auth.resetFailed";
  if (error.status === 401) return "auth.resetInvalidCredentials";
  if (error.status === 403) return "auth.resetLocalOnly";
  if (error.status === 429) return "auth.resetRateLimited";
  if (error.status === 503) return "auth.resetUnavailable";
  return "auth.resetFailed";
}

interface RecoveryFieldProps {
  id: string;
  label: string;
  type: "email" | "password";
  autoComplete: string;
  error?: string;
  registration: UseFormRegisterReturn;
}

function RecoveryField({
  id,
  label,
  type,
  autoComplete,
  error,
  registration
}: RecoveryFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs font-medium">{label}</Label>
      <Input id={id} type={type} autoComplete={autoComplete} {...registration} />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
