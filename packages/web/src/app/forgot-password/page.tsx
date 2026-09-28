import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset password"
      description="Recover a local ForgeBadger account with the host recovery key."
      titleKey="auth.resetTitle"
      descriptionKey="auth.resetDescription"
      showLanguageSwitcher
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
