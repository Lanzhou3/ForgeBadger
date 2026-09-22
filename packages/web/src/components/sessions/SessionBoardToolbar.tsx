"use client";

import { LayoutGrid, List, RotateCcw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getCliBrand } from "@/lib/cli-brand";
import { useLanguage } from "@/hooks/use-language";
import { cn } from "@/lib/utils";
import type { SessionBoardView } from "./session-board-prefs";

export interface SessionBoardToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  cliTools: string[];
  selectedCliTools: ReadonlySet<string>;
  onToggleCliTool: (tool: string) => void;
  showEmptyProjects: boolean;
  onShowEmptyProjectsChange: (value: boolean) => void;
  hasCustomColumnOrder: boolean;
  onResetColumnOrder: () => void;
  view: SessionBoardView;
  onViewChange: (view: SessionBoardView) => void;
}

/** Shared filter/view toolbar rendered above both the board and list views. */
export function SessionBoardToolbar({
  query,
  onQueryChange,
  statusFilter,
  onStatusFilterChange,
  cliTools,
  selectedCliTools,
  onToggleCliTool,
  showEmptyProjects,
  onShowEmptyProjectsChange,
  hasCustomColumnOrder,
  onResetColumnOrder,
  view,
  onViewChange,
}: SessionBoardToolbarProps) {
  const { t } = useLanguage();

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("sessions.searchPlaceholder")}
            className="pl-9"
          />
        </div>
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          value={statusFilter}
          onChange={(event) => onStatusFilterChange(event.target.value)}
          aria-label={t("sessions.statusFilter")}
        >
          <option value="all">{t("sessions.statusAll")}</option>
          <option value="running">{t("sessions.running")}</option>
          <option value="stopped">{t("sessions.stopped")}</option>
          <option value="error">{t("sessions.error")}</option>
        </select>
        {cliTools.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5" aria-label={t("sessions.cliFilter")}>
            {cliTools.map((tool) => {
              const selected = selectedCliTools.has(tool);
              return (
                <button
                  key={tool}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onToggleCliTool(tool)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                    selected
                      ? "border-brand/40 bg-brand/10 text-brand"
                      : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground"
                  )}
                >
                  {getCliBrand(tool).label}
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {hasCustomColumnOrder ? (
            <Button variant="ghost" size="sm" onClick={onResetColumnOrder}>
              <RotateCcw className="size-3.5" />
              {t("sessions.resetColumnOrder")}
            </Button>
          ) : null}
          <div
            className="flex items-center gap-0.5 rounded-md border border-border p-0.5"
            role="group"
            aria-label={t("sessions.viewToggle")}
          >
            <button
              type="button"
              aria-pressed={view === "board"}
              aria-label={t("sessions.viewBoard")}
              onClick={() => onViewChange("board")}
              className={cn(
                "flex size-7 items-center justify-center rounded transition-colors",
                view === "board"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <LayoutGrid className="size-4" />
            </button>
            <button
              type="button"
              aria-pressed={view === "list"}
              aria-label={t("sessions.viewList")}
              onClick={() => onViewChange("list")}
              className={cn(
                "flex size-7 items-center justify-center rounded transition-colors",
                view === "list"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <List className="size-4" />
            </button>
          </div>
          <Label htmlFor="session-board-show-empty" className="text-xs text-muted-foreground">
            {t("sessions.showEmptyProjects")}
          </Label>
          <Switch
            id="session-board-show-empty"
            size="sm"
            checked={showEmptyProjects}
            onCheckedChange={onShowEmptyProjectsChange}
            aria-label={t("sessions.showEmptyProjects")}
          />
        </div>
      </CardContent>
    </Card>
  );
}
