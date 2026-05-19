"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { CommandPalette } from "@/components/command-palette";
import { CopilotDrawer } from "@/components/copilot/copilot-drawer";
import {
  globalShortcutContextFromEvent,
  isCommandPaletteShortcut,
  isCopilotShortcut,
  isSidebarToggleShortcut,
  shouldHandleCopilotShortcut,
  shouldHandleGlobalShortcut,
} from "@/lib/keyboard-shortcuts";
import { appShellContainerClassName, appShellMainClassName } from "@/lib/app-shell-layout";
import { resolveCopilotRouteContext } from "@/lib/copilot-route-context";
import { Sidebar } from "./sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const isTerminalRoute = /^\/sessions\/[^/]+/u.test(pathname ?? "");
  const isCopilotRoute = pathname === "/copilot";
  const copilotRouteContext = resolveCopilotRouteContext(pathname);

  useEffect(() => {
    if (isCopilotRoute) setCopilotOpen(false);
  }, [isCopilotRoute]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const shortcutContext = globalShortcutContextFromEvent(event, { isTerminalRoute });
      if (!isCopilotRoute && isCopilotShortcut(event) && shouldHandleCopilotShortcut(shortcutContext)) {
        event.preventDefault();
        setCopilotOpen((current) => !current);
        return;
      }
      if (!shouldHandleGlobalShortcut(shortcutContext)) {
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
  }, [isCopilotRoute, isTerminalRoute]);

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
      {!isCopilotRoute && (
        <CopilotDrawer
          open={copilotOpen}
          onOpenChange={setCopilotOpen}
          context={copilotRouteContext}
        />
      )}
    </div>
  );
}
