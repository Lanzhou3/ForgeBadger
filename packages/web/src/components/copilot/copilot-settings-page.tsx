"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowLeft, Brain, CalendarClock, Cpu, Sparkles, Wrench } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CopilotSkillsCard, skillsQueryKey } from "@/components/copilot/copilot-skill-panel";
import { CopilotMemoryPanel } from "@/components/copilot/copilot-memory-panel";
import {
  CapabilitiesSection,
  copilotCapabilitiesQueryKey,
  modelProvidersQueryKey,
} from "@/components/copilot/copilot-runtime-panel";
import { useLanguage } from "@/hooks/use-language";
import { listModelProviders, listSkills } from "@/lib/api";
import { getCopilotCapabilities } from "@/lib/copilot-api";

/**
 * Copilot control panel (/copilot/settings), opened from the console's
 * top-right gear button. It exposes the self-owned Gateway runtime boundary,
 * the per-user capability switches used by the native orchestrator, and a
 * skills summary that opens a toggle dialog (full editing lives on /skills).
 */
export function CopilotSettingsPage() {
  const { t } = useLanguage();
  const router = useRouter();

  const capabilities = useQuery({
    queryKey: copilotCapabilitiesQueryKey,
    queryFn: getCopilotCapabilities,
  });
  const skills = useQuery({
    queryKey: skillsQueryKey,
    queryFn: listSkills,
  });
  const modelProviders = useQuery({
    queryKey: modelProvidersQueryKey,
    queryFn: listModelProviders,
  });

  const tools = capabilities.data?.tools ?? [];
  const enabledTools = tools.filter((tool) => tool.enabled).length;
  const skillItems = skills.data?.skills ?? [];
  const enabledSkills = skillItems.filter((skill) => skill.isEnabled).length;

  const models = (modelProviders.data?.models ?? []).filter((model) => model.status !== "disabled");
  const selected = models.find((model) => model.isDefault) ?? models[0];
  const modelLabel = selected
    ? `${selected.providerName} / ${selected.name}`
    : t("copilot.followSystemDefault");

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4 overflow-y-auto p-4 md:p-6">
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon={<Activity className="size-4" />}
          label={t("copilot.overviewRuntime")}
          value={
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              {t("copilot.runtimeOnline")}
            </span>
          }
        />
        <StatTile
          icon={<Wrench className="size-4" />}
          label={t("copilot.capabilities")}
          value={`${enabledTools}/${tools.length}`}
        />
        <StatTile
          icon={<Sparkles className="size-4" />}
          label={t("copilot.skillsTitle")}
          value={`${enabledSkills}/${skillItems.length}`}
        />
        <StatTile
          icon={<Brain className="size-4" />}
          label={t("copilot.currentModel")}
          value={<span className="truncate text-sm font-medium">{modelLabel}</span>}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <CapabilitiesSection active />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center gap-3 space-y-0">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
                <Cpu className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle className="text-sm font-semibold">{t("copilot.runtimeTitle")}</CardTitle>
                <CardDescription className="mt-1 text-xs">
                  {t("copilot.runtimeDescription")}
                </CardDescription>
              </div>
              <Badge variant="secondary" className="gap-1.5 whitespace-nowrap">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                {t("copilot.nativeRuntime")}
              </Badge>
            </CardHeader>
          </Card>

          <CopilotSkillsCard />

          <CopilotMemoryPanel />

          <Card>
            <CardHeader className="flex flex-row items-center gap-3 space-y-0">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
                <CalendarClock className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle className="text-sm font-semibold">{t("copilot.automationsTitle")}</CardTitle>
                <CardDescription className="mt-1 text-xs">
                  {t("copilot.automationsDescription")}
                </CardDescription>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/copilot/automations">{t("copilot.automationsManage")}</Link>
              </Button>
            </CardHeader>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex items-center gap-3 px-4 py-3.5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-lg font-semibold leading-none">{value}</div>
          <div className="mt-1.5 truncate text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
