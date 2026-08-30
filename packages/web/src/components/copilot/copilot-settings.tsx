"use client";

import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";

/**
 * Header entry point for Copilot settings: navigates to the full settings
 * page at /copilot/settings, which consolidates the proactive-heartbeat
 * toggle, the dsh kernel configuration (default model + plugins), and the
 * capability tool list that used to be split between a popover and the
 * persistent right-hand kernel panel.
 */
export function CopilotSettings() {
  const { t } = useLanguage();
  const router = useRouter();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("copilot.settings")}
      title={t("copilot.settings")}
      onClick={() => router.push("/copilot/settings")}
    >
      <Settings className="size-4" />
    </Button>
  );
}
