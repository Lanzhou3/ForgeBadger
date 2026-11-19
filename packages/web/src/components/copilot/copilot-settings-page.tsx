"use client";

import Link from "next/link";
import { Cpu } from "lucide-react";

import { SettingsCardHeader } from "@/components/settings/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLanguage } from "@/hooks/use-language";
import { CopilotExecutionPolicyPanel } from "./copilot-execution-policy-panel";
import { CopilotMemoryPanel } from "./copilot-memory-panel";
import { CopilotStatusBar } from "./copilot-runtime-panel";
import { CopilotSettingsShell } from "./copilot-settings-shell";
import { CopilotTeamPanel } from "./copilot-team-panel";
import { useSettingsCopy } from "./settings-copy";

/** Copilot settings hub: default model & reasoning, execution policy, team, and memory. */
export function CopilotSettingsPage() {
  const { t } = useLanguage();
  const copy = useSettingsCopy();

  return (
    <CopilotSettingsShell
      active="general"
      title={t("copilot.settings")}
      description={t("copilot.settingsDescription")}
    >
      <div className="space-y-4">
        <Card className="forgebadger-animate-in" style={{ animationDelay: "40ms" }}>
          <SettingsCardHeader
            icon={<Cpu className="size-4" />}
            title={t("copilot.runtimeTitle")}
            description={t("copilot.runtimeDescription")}
            action={
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <Link href="/models">{copy.manageModels}</Link>
              </Button>
            }
          />
          <CardContent>
            <CopilotStatusBar showLabels onModelChange={() => undefined} />
          </CardContent>
        </Card>
        <CopilotExecutionPolicyPanel />
        <CopilotTeamPanel />
        <CopilotMemoryPanel />
      </div>
    </CopilotSettingsShell>
  );
}
