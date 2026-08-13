import type { ReactNode } from "react";

import { brandAssets } from "@/lib/brand-assets";

interface AuthShellProps {
  title: string;
  description: string;
  children: ReactNode;
}

export function AuthShell({ title, description, children }: AuthShellProps) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-45"
        style={{ backgroundImage: `url(${brandAssets.background})` }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_center,hsl(var(--background)/0.22)_0%,hsl(var(--background)/0.72)_48%,hsl(var(--background)/0.96)_100%)]"
      />
      <section className="of-animate-in relative z-10 w-full max-w-[420px] rounded-lg border border-border bg-card/85 p-6 text-card-foreground shadow-2xl shadow-black/40 backdrop-blur-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
            <img
              src={brandAssets.logoSvg}
              alt=""
              className="size-7"
              aria-hidden="true"
            />
          </div>
          <div className="min-w-0">
            <div className="text-base font-semibold tracking-tight">OpenForge</div>
            <p className="text-xs text-muted-foreground">
              Local-first AI IDE control platform
            </p>
          </div>
        </div>
        <div className="mb-5">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {children}
      </section>
    </main>
  );
}
