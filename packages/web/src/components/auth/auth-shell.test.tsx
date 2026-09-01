// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LanguageProvider } from "@/hooks/use-language";
import { AuthShell } from "./auth-shell";

describe("AuthShell", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("switches authentication copy without requiring a signed-in settings page", async () => {
    render(
      <LanguageProvider>
        <AuthShell
          title="Sign in"
          description="Connect to your local ForgeBadger console."
          titleKey="auth.loginTitle"
          descriptionKey="auth.loginDescription"
          showLanguageSwitcher
        >
          <div>form</div>
        </AuthShell>
      </LanguageProvider>
    );

    expect(screen.getByRole("heading", { name: "登录" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "English" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    });
    expect(document.documentElement.lang).toBe("en");
  });
});
