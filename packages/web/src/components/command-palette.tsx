"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { navItems } from "@/components/layout/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  sidebarCollapsed,
  onToggleSidebar,
}: CommandPaletteProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const { user } = useAuth();
  const [query, setQuery] = useState("");

  const commands = useMemo(() => {
    const visibleNavItems = navItems.filter((item) => !item.adminOnly || user?.role === "admin");
    return [
      {
        id: "toggle-sidebar",
        label: sidebarCollapsed ? t("commandPalette.showSidebar") : t("commandPalette.hideSidebar"),
        group: t("commandPalette.actions"),
        icon: sidebarCollapsed ? PanelLeftOpen : PanelLeftClose,
        action: () => {
          onToggleSidebar();
          onOpenChange(false);
        },
      },
      ...visibleNavItems.map((item) => ({
        id: `nav:${item.href}`,
        label: t(item.labelKey),
        group: t("commandPalette.navigation"),
        icon: item.icon,
        action: () => {
          router.push(item.href);
          onOpenChange(false);
        },
      })),
    ];
  }, [onOpenChange, onToggleSidebar, router, sidebarCollapsed, t, user?.role]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredCommands = normalizedQuery
    ? commands.filter((command) => command.label.toLowerCase().includes(normalizedQuery))
    : commands;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <DialogContent className="gap-3 p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="text-base">{t("commandPalette.title")}</DialogTitle>
          <DialogDescription>{t("commandPalette.description")}</DialogDescription>
        </DialogHeader>
        <div className="px-4">
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
            <Search className="size-4 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              placeholder={t("commandPalette.placeholder")}
            />
          </div>
        </div>
        <div className="max-h-[420px] overflow-y-auto px-2 pb-2">
          {filteredCommands.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {t("commandPalette.noResults")}
            </div>
          ) : (
            filteredCommands.map((command) => (
              <Button
                key={command.id}
                type="button"
                variant="ghost"
                className="h-auto w-full justify-start gap-3 rounded-md px-3 py-3 text-left"
                onClick={command.action}
              >
                <command.icon className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{command.label}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{command.group}</span>
                </span>
                <ArrowRight className="size-3 text-muted-foreground" />
              </Button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
