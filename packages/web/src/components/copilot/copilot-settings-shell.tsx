"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  CalendarClock,
  Puzzle,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSettingsCopy } from "./settings-copy";

export type CopilotSettingsSection = "general" | "access" | "extensions" | "channels" | "automations";

interface NavItem {
  key: CopilotSettingsSection;
  href: string;
  icon: LucideIcon;
  label: string;
}

function useNavItems(): NavItem[] {
  const copy = useSettingsCopy();
  return [
    { key: "general", href: "/copilot/settings", icon: SlidersHorizontal, label: copy.navGeneral },
    { key: "access", href: "/copilot/settings/access", icon: ShieldCheck, label: copy.navAccess },
    { key: "extensions", href: "/copilot/extensions", icon: Puzzle, label: copy.navExtensions },
    { key: "channels", href: "/copilot/channels", icon: Radio, label: copy.navChannels },
    { key: "automations", href: "/copilot/automations", icon: CalendarClock, label: copy.navAutomations },
  ];
}

/**
 * Shared shell for every Copilot settings surface: a back-to-chat header plus
 * a persistent section nav (sidebar on desktop, scrollable chips on mobile),
 * so 常规 / 授权 / 扩展 / 渠道 / 自动化 read as one coherent settings center.
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
      <header className="forgebadger-animate-in flex items-start gap-2 pl-12 md:pl-0">
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
      <div className="flex min-h-0 flex-col gap-5 md:flex-row md:gap-8">
        <nav
          aria-label={copy.navAriaLabel}
          className="forgebadger-animate-in flex shrink-0 gap-1 overflow-x-auto pb-1 md:w-44 md:flex-col md:overflow-visible md:pb-0"
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
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                  isActive
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
              >
                <Icon className={`size-4 shrink-0 ${isActive ? "text-brand" : ""}`} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
