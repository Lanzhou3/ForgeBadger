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
        className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(8,11,16,0.22)_0%,rgba(8,11,16,0.72)_48%,rgba(8,11,16,0.96)_100%)]"
      />
      <section className="relative z-10 w-full max-w-[420px] rounded-lg border border-white/[0.08] bg-[#0b0f14]/85 p-6 text-card-foreground shadow-2xl shadow-black/40 backdrop-blur-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.04]">
            <img
              src={brandAssets.logoSvg}
              alt=""
              className="size-8"
              aria-hidden="true"
            />
          </div>
          <div className="min-w-0">
            <div className="text-lg font-semibold tracking-tight">OpenForge</div>
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
