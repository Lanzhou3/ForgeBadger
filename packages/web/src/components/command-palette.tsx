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
  const [selectedIndex, setSelectedIndex] = useState(0);

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
  const activeIndex = filteredCommands.length > 0 ? Math.min(selectedIndex, filteredCommands.length - 1) : -1;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          setQuery("");
          setSelectedIndex(0);
        }
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
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={(event) => {
                if (filteredCommands.length === 0) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSelectedIndex((current) => (current + 1) % filteredCommands.length);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSelectedIndex((current) => (current - 1 + filteredCommands.length) % filteredCommands.length);
                } else if (event.key === "Enter" && activeIndex >= 0) {
                  event.preventDefault();
                  filteredCommands[activeIndex]?.action();
                }
              }}
              className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              placeholder={t("commandPalette.placeholder")}
            />
          </div>
        </div>
        <div className="max-h-[420px] overflow-y-auto px-2 pb-2" role="listbox">
          {filteredCommands.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {t("commandPalette.noResults")}
            </div>
          ) : (
            filteredCommands.map((command, index) => (
              <Button
                key={command.id}
                type="button"
                variant="ghost"
                role="option"
                aria-selected={index === activeIndex}
                className={`h-auto w-full justify-start gap-3 rounded-md px-3 py-3 text-left ${index === activeIndex ? "bg-accent text-accent-foreground" : ""}`}
                onMouseEnter={() => setSelectedIndex(index)}
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
