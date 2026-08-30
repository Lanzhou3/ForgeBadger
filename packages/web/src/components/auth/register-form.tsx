"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z
  .object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type FormData = z.infer<typeof schema>;

export function RegisterForm() {
  const router = useRouter();
  const { register: registerAuth } = useAuth();
  const [isHydrated, setIsHydrated] = useState(false);
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
      const result = await registerAuth({ email: data.email, password: data.password });
      if (result.code === 0) {
        router.replace("/");
      } else {
        setError("root", { message: result.message || "Registration failed" });
      }
    } catch (err) {
      setError("root", {
        message: err instanceof Error ? err.message : "Registration failed",
      });
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
          Email
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
        <Label htmlFor="password" className="text-xs font-medium">
          Password
        </Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          {...register("password")}
        />
        {errors.password && (
          <p className="text-xs text-destructive">{errors.password.message}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirmPassword" className="text-xs font-medium">
          Confirm Password
        </Label>
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          {...register("confirmPassword")}
        />
        {errors.confirmPassword && (
          <p className="text-xs text-destructive">
            {errors.confirmPassword.message}
          </p>
        )}
      </div>
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
        {isSubmitting ? "Creating account..." : "Create account"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
