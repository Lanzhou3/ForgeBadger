"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface FormData {
  email: string;
  password: string;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const { t } = useLanguage();
  const [isHydrated, setIsHydrated] = useState(false);
  const schema = useMemo(() => z.object({
    email: z.string().email(t("auth.emailInvalid")),
    password: z.string().min(1, t("auth.passwordRequired"))
  }), [t]);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  const onSubmit = async (data: FormData) => {
    try {
      const result = await login({ email: data.email, password: data.password });
      if (result.code === 0) {
        router.replace(safeRedirectTarget(searchParams.get("next")));
      } else {
        setError("root", { message: t("auth.loginFailed") });
      }
    } catch {
      setError("root", { message: t("auth.loginFailed") });
    }
  };

  return (
    <form
      method="post"
      onSubmit={handleSubmit(onSubmit)}
      className="forgebadger-animate-in flex flex-col gap-4"
      style={{ animationDelay: "60ms" }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email" className="text-xs font-medium">
          {t("auth.email")}
        </Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          {...register("email")}
        />
        {errors.email && (
          <p className="text-xs text-destructive">{errors.email.message}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="password" className="text-xs font-medium">
            {t("auth.password")}
          </Label>
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-brand underline-offset-4 hover:underline"
          >
            {t("auth.forgotPassword")}
          </Link>
        </div>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          {...register("password")}
        />
        {errors.password && (
          <p className="text-xs text-destructive">{errors.password.message}</p>
        )}
      </div>
      {searchParams.get("passwordReset") === "1" && (
        <p className="rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-xs text-foreground">
          {t("auth.passwordResetSuccess")}
        </p>
      )}
      {errors.root && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {errors.root.message}
        </p>
      )}
      <Button
        type="submit"
        disabled={!isHydrated || isSubmitting}
        className="mt-1 bg-brand text-brand-foreground hover:bg-brand/90"
      >
        {isSubmitting ? t("auth.signingIn") : t("auth.signIn")}
      </Button>
      <p className="text-xs text-muted-foreground">
        {t("auth.noAccount")}{" "}
        <Link href="/register" className="font-medium text-brand underline-offset-4 hover:underline">
          {t("auth.register")}
        </Link>
      </p>
    </form>
  );
}

/**
 * Only same-origin app paths are honored as post-login redirect targets:
 * must start with "/" but not "//" (protocol-relative) to avoid open redirects.
 */
function safeRedirectTarget(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}
