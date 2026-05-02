"use client";

import { useEffect, useState, type ReactNode } from "react";

import { CommandPalette } from "@/components/command-palette";
import { isCommandPaletteShortcut, isSidebarToggleShortcut } from "@/lib/keyboard-shortcuts";
import { Sidebar } from "./sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
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
  }, []);

  return (
    <div className="flex h-screen w-screen bg-background text-foreground">
      <Sidebar collapsed={sidebarCollapsed} />
      <main className="flex-1 overflow-auto">{children}</main>
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
      />
    </div>
  );
}
