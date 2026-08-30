import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { AuthShell } from "@/components/auth/auth-shell";

export default function LoginPage() {
  return (
    <AuthShell
      title="Sign in"
      description="Connect to your local ForgeBadger console."
    >
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
