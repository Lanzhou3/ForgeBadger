"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { CommandPalette } from "@/components/command-palette";
import {
  globalShortcutContextFromEvent,
  isCommandPaletteShortcut,
  isSidebarToggleShortcut,
  shouldHandleGlobalShortcut,
} from "@/lib/keyboard-shortcuts";
import { appShellContainerClassName, appShellMainClassName } from "@/lib/app-shell-layout";
import { Sidebar } from "./sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const isTerminalRoute = /^\/sessions\/[^/]+/u.test(pathname ?? "");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!shouldHandleGlobalShortcut(globalShortcutContextFromEvent(event, { isTerminalRoute }))) {
        return;
      }

      if (isSidebarToggleShortcut(event)) {
        event.preventDefault();
        setSidebarCollapsed((current) => !current);
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
        Skip to content
      </a>
      <Sidebar collapsed={sidebarCollapsed} />
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
        onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
      />
    </div>
  );
}
