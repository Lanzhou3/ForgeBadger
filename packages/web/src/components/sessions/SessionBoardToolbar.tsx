"use client";

import { useEffect, useRef } from "react";
import { LayoutGrid, List, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";

import { CliBrandIcon } from "@/components/cli-brand-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { getCliBrand } from "@/lib/cli-brand";
import { useLanguage } from "@/hooks/use-language";
import { useTrilingual } from "@/hooks/use-trilingual";
import { cn } from "@/lib/utils";
import type { SessionBoardView } from "./session-board-prefs";
import type { SessionStatusCounts } from "./session-board-utils";

export interface SessionBoardToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  statusCounts: SessionStatusCounts;
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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

interface StatusItem {
  value: string;
  label: string;
  count: number;
  dotClass?: string;
  hidden?: boolean;
}

/** CLI chip group shared by the inline filter row and the compact popover. */
function CliFilterChips({
  cliTools,
  selectedCliTools,
  onToggleCliTool,
  label,
}: {
  cliTools: string[];
  selectedCliTools: ReadonlySet<string>;
  onToggleCliTool: (tool: string) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {cliTools.map((tool) => {
        const selected = selectedCliTools.has(tool);
        const brand = getCliBrand(tool);
        return (
          <button
            key={tool}
            type="button"
            aria-pressed={selected}
            onClick={() => onToggleCliTool(tool)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border border-border/70 bg-background/50 px-2.5 text-xs font-medium text-muted-foreground transition-colors",
              "hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              "aria-pressed:border-brand/45 aria-pressed:bg-brand/12 aria-pressed:text-brand"
            )}
          >
            {brand.id !== "unknown" ? (
              <CliBrandIcon
                aiTool={tool}
                className={brand.id === "mcode" ? "size-3.5" : "size-3"}
              />
            ) : (
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full"
                style={{ backgroundColor: brand.color }}
              />
            )}
            {brand.label}
          </button>
        );
      })}
    </div>
  );
}

function ShowEmptyToggle({
  id,
  showEmptyProjects,
  onShowEmptyProjectsChange,
  className,
}: {
  id: string;
  showEmptyProjects: boolean;
  onShowEmptyProjectsChange: (value: boolean) => void;
  className?: string;
}) {
  const { t } = useLanguage();
  const labelId = `${id}-label`;
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Label id={labelId} htmlFor={id} className="cursor-pointer text-xs text-muted-foreground">
        {t("sessions.showEmptyProjects")}
      </Label>
      <Switch
        id={id}
        size="sm"
        checked={showEmptyProjects}
        onCheckedChange={onShowEmptyProjectsChange}
        aria-labelledby={labelId}
      />
    </div>
  );
}

/** Shared filter/view toolbar rendered above both the board and list views. */
export function SessionBoardToolbar({
  query,
  onQueryChange,
  statusFilter,
  onStatusFilterChange,
  statusCounts,
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
  const pick = useTrilingual();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // "/" focuses the board search from anywhere outside another input, so a
  // keyboard user can filter without reaching for the mouse.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const statusItems: StatusItem[] = [
    { value: "all", label: t("sessions.statusAll"), count: statusCounts.all },
    { value: "running", label: t("sessions.running"), count: statusCounts.running, dotClass: "bg-success" },
    { value: "stopped", label: t("sessions.stopped"), count: statusCounts.stopped },
    {
      value: "error",
      label: t("sessions.error"),
      count: statusCounts.error,
      dotClass: "bg-destructive",
      hidden: statusCounts.error === 0 && statusFilter !== "error",
    },
    {
      value: "lost",
      label: t("sessions.lost"),
      count: statusCounts.lost,
      dotClass: "bg-warning",
      hidden: statusCounts.lost === 0 && statusFilter !== "lost",
    },
  ];

  const activeFilterCount =
    selectedCliTools.size + (statusFilter !== "all" ? 1 : 0) + (showEmptyProjects ? 1 : 0);

  return (
    <div
      role="toolbar"
      aria-label={t("sessions.title")}
      className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border/70 bg-card/65 px-3 py-2 backdrop-blur-xs"
    >
      <div className="flex min-w-[200px] flex-1 items-center gap-2 sm:max-w-xs">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            ref={searchInputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                if (query) onQueryChange("");
                else searchInputRef.current?.blur();
              }
            }}
            placeholder={t("sessions.searchPlaceholder")}
            aria-label={t("sessions.searchPlaceholder")}
            className="h-8 bg-background/70 pl-8 pr-8 text-xs md:text-xs"
          />
          {query ? (
            <button
              type="button"
              aria-label={pick("清除搜索", "清除搜尋", "Clear search")}
              onClick={() => {
                onQueryChange("");
                searchInputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          ) : (
            <kbd
              aria-hidden="true"
              className="pointer-events-none absolute right-2 top-1/2 hidden h-4 min-w-4 -translate-y-1/2 items-center justify-center rounded border border-border/80 bg-muted/50 px-1 font-mono text-[10px] text-muted-foreground sm:inline-flex"
            >
              /
            </kbd>
          )}
        </div>
        {/* Compact viewports collapse the CLI chips and secondary toggles into
            one popover so the board keeps a single, scannable control row. */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1.5 px-2.5 text-xs sm:hidden"
              aria-label={pick("筛选与视图", "篩選與檢視", "Filters and view")}
            >
              <SlidersHorizontal className="size-3.5" aria-hidden="true" />
              {activeFilterCount > 0 ? (
                <span className="forgebadger-tabular-nums rounded-full bg-brand/15 px-1.5 text-[10px] font-semibold text-brand">
                  {activeFilterCount}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 space-y-3 p-3">
            {cliTools.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-muted-foreground">{t("sessions.cliFilter")}</p>
                <CliFilterChips
                  cliTools={cliTools}
                  selectedCliTools={selectedCliTools}
                  onToggleCliTool={onToggleCliTool}
                  label={t("sessions.cliFilter")}
                />
              </div>
            ) : null}
            <ShowEmptyToggle
              id="session-board-show-empty-compact"
              showEmptyProjects={showEmptyProjects}
              onShowEmptyProjectsChange={onShowEmptyProjectsChange}
              className="justify-between"
            />
          </PopoverContent>
        </Popover>
      </div>

      <div
        role="group"
        aria-label={t("sessions.statusFilter")}
        className="flex flex-wrap items-center gap-0.5 rounded-md border border-border/70 bg-muted/35 p-0.5"
      >
        {statusItems
          .filter((item) => !item.hidden)
          .map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={statusFilter === item.value}
              onClick={() => onStatusFilterChange(item.value)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium text-muted-foreground transition-[background-color,color,box-shadow]",
                "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                "aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-xs"
              )}
            >
              {item.dotClass ? (
                <span className={cn("size-1.5 rounded-full", item.dotClass)} aria-hidden="true" />
              ) : null}
              <span>{item.label}</span>
              <span className="forgebadger-tabular-nums text-[11px] opacity-65">{item.count}</span>
            </button>
          ))}
      </div>

      {cliTools.length > 0 ? (
        <>
          <span role="separator" aria-orientation="vertical" className="hidden h-4 border-l border-border/70 lg:inline-block" />
          <div className="hidden sm:block">
            <CliFilterChips
              cliTools={cliTools}
              selectedCliTools={selectedCliTools}
              onToggleCliTool={onToggleCliTool}
              label={t("sessions.cliFilter")}
            />
          </div>
        </>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        {hasCustomColumnOrder ? (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onResetColumnOrder}>
            <RotateCcw className="size-3.5" />
            {t("sessions.resetColumnOrder")}
          </Button>
        ) : null}
        <div className="hidden items-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-2 py-1 sm:flex">
          <ShowEmptyToggle
            id="session-board-show-empty"
            showEmptyProjects={showEmptyProjects}
            onShowEmptyProjectsChange={onShowEmptyProjectsChange}
          />
        </div>
        <div
          className="hidden items-center gap-0.5 rounded-md border border-border/70 bg-muted/35 p-0.5 md:flex"
          role="group"
          aria-label={t("sessions.viewToggle")}
        >
          <button
            type="button"
            aria-pressed={view === "board"}
            aria-label={t("sessions.viewBoard")}
            onClick={() => onViewChange("board")}
            className="flex size-7 items-center justify-center rounded text-muted-foreground transition-[background-color,color,box-shadow] hover:text-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <LayoutGrid className="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-pressed={view === "list"}
            aria-label={t("sessions.viewList")}
            onClick={() => onViewChange("list")}
            className="flex size-7 items-center justify-center rounded text-muted-foreground transition-[background-color,color,box-shadow] hover:text-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <List className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
