import { RegisterForm } from "@/components/auth/register-form";
import { AuthShell } from "@/components/auth/auth-shell";

export default function RegisterPage() {
  return (
    <AuthShell
      title="Create account"
      description="Bootstrap a local user for this ForgeBadger instance."
      titleKey="auth.registerTitle"
      descriptionKey="auth.registerDescription"
      showLanguageSwitcher
    >
      <RegisterForm />
    </AuthShell>
  );
}
