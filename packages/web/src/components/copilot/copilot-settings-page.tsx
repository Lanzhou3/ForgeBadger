"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CapabilitiesSection } from "@/components/copilot/copilot-runtime-panel";
import { useLanguage } from "@/hooks/use-language";

/**
 * Full Copilot settings page (/copilot/settings), opened from the console's
 * top-right gear button. It exposes the self-owned Gateway runtime boundary
 * and the per-user capability switches used by the native orchestrator.
 */
export function CopilotSettingsPage() {
  const { t } = useLanguage();
  const router = useRouter();

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <div className="flex items-start gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("copilot.settingsBack")}
          title={t("copilot.settingsBack")}
          onClick={() => router.push("/copilot")}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{t("copilot.settings")}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("copilot.settingsDescription")}</p>
        </div>
      </div>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("copilot.runtimeTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("copilot.runtimeDescription")}</p>
          </div>
          <Badge variant="secondary" className="gap-1.5 whitespace-nowrap">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {t("copilot.nativeRuntime")}
          </Badge>
        </div>
      </section>

      <CapabilitiesSection active />
    </div>
  );
}
