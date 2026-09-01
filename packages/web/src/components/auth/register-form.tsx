"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { GatewayApiError } from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";

interface FormData {
  email: string;
  recoveryKey: string;
  password: string;
  confirmPassword: string;
}

export function RegisterForm() {
  const router = useRouter();
  const { register: registerAuth } = useAuth();
  const { t } = useLanguage();
  const [isHydrated, setIsHydrated] = useState(false);
  const schema = useMemo(() => z.object({
    email: z.string().email(t("auth.emailInvalid")),
    recoveryKey: z.string().min(1, t("auth.recoveryKeyRequired")),
    password: z.string().min(8, t("auth.passwordMinLength")),
    confirmPassword: z.string().min(1, t("auth.registrationConfirmPasswordRequired"))
  }).refine((data) => data.password === data.confirmPassword, {
    message: t("auth.passwordsDoNotMatch"),
    path: ["confirmPassword"]
  }), [t]);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  const onSubmit = async (data: FormData) => {
    try {
      const result = await registerAuth({
        email: data.email,
        password: data.password,
        recoveryKey: data.recoveryKey.trim()
      });
      if (result.code === 0) {
        router.replace("/");
        return;
      }
      setError("root", { message: t("auth.registrationFailed") });
    } catch (error) {
      setError("root", { message: t(registrationErrorKey(error)) });
    }
  };

  return (
    <form
      method="post"
      onSubmit={handleSubmit(onSubmit)}
      className="forgebadger-animate-in flex flex-col gap-4"
      style={{ animationDelay: "60ms" }}
    >
      <p className="rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
        {t("auth.registrationInstructions")}
      </p>
      <RegisterField
        id="email"
        label={t("auth.email")}
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        registration={register("email")}
      />
      <RegisterField
        id="recoveryKey"
        label={t("auth.recoveryKey")}
        type="password"
        autoComplete="off"
        error={errors.recoveryKey?.message}
        registration={register("recoveryKey")}
      />
      <RegisterField
        id="password"
        label={t("auth.password")}
        type="password"
        autoComplete="new-password"
        error={errors.password?.message}
        registration={register("password")}
      />
      <RegisterField
        id="confirmPassword"
        label={t("auth.confirmPassword")}
        type="password"
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        registration={register("confirmPassword")}
      />
      {errors.root ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {errors.root.message}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={!isHydrated || isSubmitting}
        className="mt-1 bg-brand text-brand-foreground hover:bg-brand/90"
      >
        {isSubmitting ? t("auth.creatingAccount") : t("auth.createAccount")}
      </Button>
      <p className="text-xs text-muted-foreground">
        {t("auth.alreadyHaveAccount")} {" "}
        <Link href="/login" className="font-medium text-brand underline-offset-4 hover:underline">
          {t("auth.signIn")}
        </Link>
      </p>
    </form>
  );
}

interface RegisterFieldProps {
  id: string;
  label: string;
  type: "email" | "password";
  autoComplete: string;
  error?: string;
  registration: UseFormRegisterReturn;
}

function RegisterField({
  id,
  label,
  type,
  autoComplete,
  error,
  registration
}: RegisterFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs font-medium">{label}</Label>
      <Input id={id} type={type} autoComplete={autoComplete} {...registration} />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function registrationErrorKey(error: unknown): TranslationKey {
  if (!(error instanceof GatewayApiError)) return "auth.registrationFailed";
  if (error.status === 401) return "auth.registrationInvalidCredentials";
  if (error.status === 403) return "auth.registrationUnavailable";
  if (error.status === 409) return "auth.emailAlreadyRegistered";
  if (error.status === 429) return "auth.registrationRateLimited";
  return "auth.registrationFailed";
}
