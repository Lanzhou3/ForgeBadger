"use client";

import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { createConversation } from "@/lib/copilot-api";
import { CopilotGrantsPanel } from "./CopilotGrantsPanel";
import { CopilotSettingsShell } from "./copilot-settings-shell";
import { useSettingsCopy } from "./settings-copy";

const steps = ["howStep1", "howStep2", "howStep3"] as const;

/**
 * Dedicated authorization page: explains how project grants work and hosts
 * the full grant lifecycle (create / start conversation / revoke / delete).
 */
export function CopilotAccessPage() {
  const copy = useSettingsCopy();
  const router = useRouter();
  return (
    <CopilotSettingsShell
      active="access"
      title={copy.accessTitle}
      description={copy.accessDescription}
    >
      <div className="space-y-5">
        <section
          className="forgebadger-animate-in space-y-3 rounded-lg border border-border bg-card p-4"
          style={{ animationDelay: "120ms" }}
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 text-brand" />
            {copy.howTitle}
          </h2>
          <ol className="grid gap-2 sm:grid-cols-3">
            {steps.map((step, index) => (
              <li
                key={step}
                className="flex items-center gap-2.5 rounded-md border border-border/70 px-3 py-2.5 text-xs"
              >
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[11px] font-semibold text-brand">
                  {index + 1}
                </span>
                {copy[step]}
              </li>
            ))}
          </ol>
          <p className="text-xs leading-relaxed text-muted-foreground">{copy.howNote}</p>
        </section>
        <div className="forgebadger-animate-in" style={{ animationDelay: "180ms" }}>
          <CopilotGrantsPanel
            onStartConversation={async (grantId) => {
              const { conversation } = await createConversation(undefined, grantId);
              router.push(`/copilot?c=${conversation.id}`);
            }}
          />
        </div>
      </div>
    </CopilotSettingsShell>
  );
}
