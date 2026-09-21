"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  ChevronRight,
  Cpu,
  Puzzle,
  Radio,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopilotMemoryPanel } from "./copilot-memory-panel";
import { modelProvidersQueryKey } from "./copilot-runtime-panel";
import { CopilotSettingsShell } from "./copilot-settings-shell";
import { useExtensionsCopy } from "./extensions-copy";
import { useSettingsCopy } from "./settings-copy";
import { useLanguage } from "@/hooks/use-language";
import { listModelProviders } from "@/lib/api";
import {
  copilotConnectionsKey,
  copilotSkillsKey,
  listCopilotConnections,
  listCopilotSkills,
} from "@/lib/copilot-extensions-api";
import { listGrants } from "@/lib/platform-actions-api";

/** Copilot settings hub: runtime status, entries into each settings section, and memory. */
export function CopilotSettingsPage() {
  const { t } = useLanguage();
  const copy = useSettingsCopy();
  const extensions = useExtensionsCopy();
  const providers = useQuery({
    queryKey: modelProvidersQueryKey,
    queryFn: listModelProviders,
    retry: false,
  });
  const grants = useQuery({ queryKey: ["copilot-grants"], queryFn: listGrants, retry: false });
  const skills = useQuery({ queryKey: copilotSkillsKey, queryFn: listCopilotSkills, retry: false });
  const connections = useQuery({
    queryKey: copilotConnectionsKey,
    queryFn: listCopilotConnections,
    retry: false,
  });
  const models = (providers.data?.models ?? []).filter((model) => model.status !== "disabled");
  const selected = models.find((model) => model.isDefault) ?? models[0];
  const modelLabel = providers.isPending
    ? extensions.loading
    : providers.isError
      ? extensions.loadError
      : selected
        ? `${selected.providerName} / ${selected.name}`
        : t("copilot.followSystemDefault");
  const activeGrants = grants.data?.grants.filter((grant) => grant.status === "active").length;
  const skillCount = skills.data?.skills.length;
  const connectionCount = connections.data?.connections.filter((item) => item.kind === "mcp").length;

  const entries: {
    href: string;
    icon: LucideIcon;
    title: string;
    description: string;
    summary?: string;
    delay: number;
  }[] = [
    {
      href: "/copilot/settings/access",
      icon: ShieldCheck,
      title: copy.accessCardTitle,
      description: copy.accessCardDescription,
      summary: activeGrants !== undefined ? `${activeGrants} · ${copy.statusActive}` : undefined,
      delay: 180,
    },
    {
      href: "/copilot/extensions",
      icon: Puzzle,
      title: extensions.title,
      description: extensions.description,
      summary:
        skillCount !== undefined && connectionCount !== undefined
          ? `${skillCount} ${extensions.skills} · ${connectionCount} ${extensions.connections}`
          : undefined,
      delay: 240,
    },
    {
      href: "/copilot/channels",
      icon: Radio,
      title: copy.channelsCardTitle,
      description: copy.channelsCardDescription,
      delay: 300,
    },
    {
      href: "/copilot/automations",
      icon: CalendarClock,
      title: t("copilot.automationsTitle"),
      description: t("copilot.automationsDescription"),
      delay: 360,
    },
  ];

  return (
    <CopilotSettingsShell
      active="general"
      title={t("copilot.settings")}
      description={t("copilot.settingsDescription")}
    >
      <div className="space-y-5">
        <section
          className="forgebadger-animate-in space-y-3 rounded-lg border border-border bg-card p-4"
          style={{ animationDelay: "120ms" }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Cpu className="size-4 text-brand" />
            <h2 className="text-sm font-semibold">{t("copilot.runtimeTitle")}</h2>
            <Badge variant="secondary" className="ml-auto gap-1.5">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              {t("copilot.nativeRuntime")}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{t("copilot.runtimeDescription")}</p>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2.5">
            <p className="min-w-0 truncate text-xs">
              <span className="text-muted-foreground">{t("copilot.currentModel")}: </span>
              {modelLabel}
            </p>
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link href="/models">{copy.manageModels}</Link>
            </Button>
          </div>
        </section>
        <div className="grid gap-3 sm:grid-cols-2">
          {entries.map((entry) => {
            const Icon = entry.icon;
            return (
              <Link
                key={entry.href}
                href={entry.href}
                className="forgebadger-animate-in group flex items-start gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-brand/40 hover:bg-muted/40"
                style={{ animationDelay: `${entry.delay}ms` }}
              >
                <Icon className="mt-0.5 size-5 shrink-0 text-brand" />
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {entry.title}
                    {entry.summary && (
                      <Badge variant="secondary" className="font-normal">
                        {entry.summary}
                      </Badge>
                    )}
                  </span>
                  <span className="block text-xs leading-relaxed text-muted-foreground">
                    {entry.description}
                  </span>
                </span>
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
              </Link>
            );
          })}
        </div>
        <div className="forgebadger-animate-in" style={{ animationDelay: "420ms" }}>
          <CopilotMemoryPanel />
        </div>
      </div>
    </CopilotSettingsShell>
  );
}
