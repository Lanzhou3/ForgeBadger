"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { CommandPalette } from "@/components/command-palette";
import { CopilotRobotHost } from "@/components/copilot/copilot-robot-host";
import { SessionBookmark } from "@/components/session-bookmark";
import { useLanguage } from "@/hooks/use-language";
import {
  globalShortcutContextFromEvent,
  isCommandPaletteShortcut,
  isSidebarToggleShortcut,
  shouldHandleGlobalShortcut,
} from "@/lib/keyboard-shortcuts";
import { appShellContainerClassName, appShellMainClassName } from "@/lib/app-shell-layout";
import { Sidebar } from "./sidebar";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "forgebadger.sidebar-collapsed";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const isTerminalRoute = /^\/sessions\/[^/]+/u.test(pathname ?? "");

  useEffect(() => {
    try {
      setSidebarCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1");
    } catch {
      // Ignore storage access failures in restricted environments.
    }
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Ignore storage access failures.
      }
      return next;
    });
  };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const shortcutContext = globalShortcutContextFromEvent(event, { isTerminalRoute });
      if (!shouldHandleGlobalShortcut(shortcutContext)) {
        return;
      }

      if (isSidebarToggleShortcut(event)) {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (isCommandPaletteShortcut(event)) {
        event.preventDefault();
        setCommandPaletteOpen((current) => !current);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isTerminalRoute]);

  return (
    <div className={appShellContainerClassName}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:text-foreground focus:ring-2 focus:ring-ring"
      >
        {t("nav.skipToContent")}
      </a>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
      />
      <main
        id="main-content"
        tabIndex={-1}
        className={appShellMainClassName(isTerminalRoute)}
      >
        {children}
      </main>
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
      />
      <CopilotRobotHost />
      <SessionBookmark />
    </div>
  );
}
