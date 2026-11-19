"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { skipToken, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarClock,
  Puzzle,
  Radio,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSettingsCopy } from "./settings-copy";

export type CopilotSettingsSection = "general" | "extensions" | "channels" | "automations";

interface NavItem {
  key: CopilotSettingsSection;
  href: string;
  icon: LucideIcon;
  label: string;
  count?: number;
}

function useNavCounts(): { extensions?: number; automations?: number } {
  // Subscribe to React Query cache without issuing network calls so pages/tests
  // that only mock a subset of Copilot APIs never fail or fire extra requests.
  const skills = useQuery<{ skills?: unknown[] }>({ queryKey: ["copilot", "skills"], queryFn: skipToken, retry: false });
  const connections = useQuery<{ connections?: { kind?: string }[] }>({
    queryKey: ["copilot", "connections"],
    queryFn: skipToken,
    retry: false,
  });
  const roots = useQuery<{ roots?: unknown[] }>({ queryKey: ["copilot", "machine-roots"], queryFn: skipToken, retry: false });
  const automations = useQuery<{ automations?: { status?: string }[] }>({
    queryKey: ["copilot", "automations"],
    queryFn: skipToken,
    retry: false,
  });

  const hasExtensions = skills.data !== undefined || connections.data !== undefined || roots.data !== undefined;
  const extensionsTotal =
    (skills.data?.skills?.length ?? 0) +
    (connections.data?.connections?.filter((item) => item.kind === "mcp").length ?? 0) +
    (roots.data?.roots?.length ?? 0);
  const enabledAutomations = automations.data?.automations?.filter((item) => item.status === "enabled").length;

  return {
    extensions: hasExtensions && extensionsTotal > 0 ? extensionsTotal : undefined,
    automations: enabledAutomations && enabledAutomations > 0 ? enabledAutomations : undefined,
  };
}

function useNavItems(): NavItem[] {
  const copy = useSettingsCopy();
  const counts = useNavCounts();
  return [
    { key: "general", href: "/copilot/settings", icon: SlidersHorizontal, label: copy.navGeneral },
    { key: "extensions", href: "/copilot/extensions", icon: Puzzle, label: copy.navExtensions, count: counts.extensions },
    { key: "channels", href: "/copilot/channels", icon: Radio, label: copy.navChannels },
    { key: "automations", href: "/copilot/automations", icon: CalendarClock, label: copy.navAutomations, count: counts.automations },
  ];
}

/**
 * Shared shell for every Copilot settings surface: a back-to-chat header plus
 * a persistent section nav (sidebar on desktop, scrollable chips on mobile),
 * so 常规 / 扩展 / 渠道 / 自动化 read as one coherent settings center.
 */
export function CopilotSettingsShell({
  active,
  title,
  description,
  children,
}: {
  active: CopilotSettingsSection;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const copy = useSettingsCopy();
  const router = useRouter();
  const items = useNavItems();
  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-5 overflow-y-auto p-4 md:p-6">
      <header className="forgebadger-animate-in flex items-start gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={copy.backToChat}
          title={copy.backToChat}
          onClick={() => router.push("/copilot")}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
      </header>
      <div className="flex min-h-0 flex-col gap-5 lg:flex-row lg:gap-8">
        <div className="relative min-w-0 lg:sticky lg:top-6 lg:w-[200px] lg:shrink-0 lg:self-start">
          {/* Right-edge fade hints that the chip row scrolls horizontally on
              small screens (removed on desktop where the nav is a column). */}
          <nav
            aria-label={copy.navAriaLabel}
            className="forgebadger-animate-in flex shrink-0 gap-1 overflow-x-auto pb-1 [mask-image:linear-gradient(to_right,black_80%,transparent)] lg:flex-col lg:overflow-visible lg:pb-0 lg:[mask-image:none]"
            style={{ animationDelay: "60ms" }}
          >
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = item.key === active;
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-150 ${
                  isActive
                    ? "bg-card text-foreground shadow-card ring-1 ring-border/70"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
              >
                {isActive && (
                  <span
                    className="hidden h-4 w-0.5 rounded-full bg-brand lg:block"
                    aria-hidden="true"
                  />
                )}
                <Icon
                  strokeWidth={1.75}
                  className={`size-4 shrink-0 ${isActive ? "text-brand" : "text-muted-foreground/75"}`}
                />
                <span>{item.label}</span>
                {item.count !== undefined ? (
                  <Badge
                    variant="secondary"
                    aria-hidden="true"
                    className="ml-auto h-4 px-1.5 text-[10px] font-normal tabular-nums text-muted-foreground"
                  >
                    {item.count}
                  </Badge>
                ) : null}
              </Link>
            );
          })}
          </nav>
        </div>
        <div className="min-w-0 max-w-3xl flex-1">{children}</div>
      </div>
    </div>
  );
}
