"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import { readSessionTabs, removeSessionTab, type SessionTab } from "@/lib/session-tabs";

interface Props {
  activeSessionId: string;
}

export function SessionTabs({ activeSessionId }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useLanguage();
  const [tabs, setTabs] = useState<SessionTab[]>([]);

  const refreshTabs = useCallback(() => {
    setTabs(readSessionTabs());
  }, []);

  useEffect(() => {
    refreshTabs();
    window.addEventListener("storage", refreshTabs);
    window.addEventListener("openforge-session-tabs-changed", refreshTabs);
    return () => {
      window.removeEventListener("storage", refreshTabs);
      window.removeEventListener("openforge-session-tabs-changed", refreshTabs);
    };
  }, [refreshTabs]);

  const closeTab = (sessionId: string) => {
    const nextTabs = removeSessionTab(sessionId);
    setTabs(nextTabs);
    if (sessionId !== activeSessionId) {
      return;
    }

    const nextActive = nextTabs.find((tab) => tab.id !== sessionId);
    router.push(nextActive ? `/sessions/${nextActive.id}` : "/sessions");
  };

  return (
    <div className="flex h-10 min-w-0 items-end gap-1 overflow-x-auto border-b border-border bg-background px-3 pt-2 [scrollbar-width:thin]">
      {tabs.map((tab) => {
        const active = tab.id === activeSessionId || pathname === `/sessions/${tab.id}`;
        return (
          <div
            key={tab.id}
            className={
              active
                ? "group flex h-8 max-w-56 shrink-0 items-center gap-2 rounded-t-md border border-b-background border-border bg-background px-3 text-left text-xs text-foreground shadow-[inset_0_2px_0_theme(colors.orange.500)]"
                : "group flex h-8 max-w-56 shrink-0 items-center gap-2 rounded-t-md border border-border bg-muted/30 px-3 text-left text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            }
            title={`${tab.label}${tab.projectName ? ` · ${tab.projectName}` : ""}`}
          >
            <span className={tab.status === "running" ? "size-1.5 rounded-full bg-green-500" : "size-1.5 rounded-full bg-muted-foreground/50"} />
            <Link href={`/sessions/${tab.id}`} className="min-w-0 flex-1 truncate">
              {tab.label}
            </Link>
            <button
              type="button"
              aria-label={`${t("sessions.closeTab")} ${tab.label}`}
              className="rounded p-0.5 text-muted-foreground opacity-70 hover:bg-muted hover:text-foreground group-hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                closeTab(tab.id);
              }}
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
      <Button
        asChild
        variant="ghost"
        size="icon"
        className="mb-0.5 size-7 shrink-0 text-muted-foreground"
        title={t("sessions.openSessionList")}
        aria-label={t("sessions.openSessionList")}
      >
        <Link href="/sessions">
          <Plus className="size-3.5" />
        </Link>
      </Button>
    </div>
  );
}

export function notifySessionTabsChanged() {
  window.dispatchEvent(new Event("openforge-session-tabs-changed"));
}
