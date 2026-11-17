"use client";

import { useDeferredValue, useState } from "react";
import { FileCode2, LockKeyhole, Search } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useTrilingual } from "@/hooks/use-trilingual";
import type { Template } from "@/lib/api";
import { getCliBrand } from "@/lib/cli-brand";
import {
  filterByVisibility,
  normalizeVisibility,
  visibilityLabelKey,
  visibilityOptions,
  type VisibilityFilter,
} from "@/lib/visibility";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QueryState } from "@/components/ui/query-state";
import { cn } from "@/lib/utils";

interface Props {
  templates: Template[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}

export function TemplateLibrary({
  templates,
  selectedId,
  onSelect,
  loading,
  error,
  onRetry,
}: Props) {
  const { t } = useLanguage();
  const pick = useTrilingual();
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim().toLowerCase());
  const [adapter, setAdapter] = useState("all");
  const [visibility, setVisibility] = useState<VisibilityFilter>("all");
  const [kind, setKind] = useState("all");
  const builtin = (template: Template) =>
    Boolean(template.isBuiltin || template.builtin);
  const adapters = [
    ...new Set(
      templates
        .map((template) => template.adapter)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const base = filterByVisibility(templates, visibility).filter(
    (template) =>
      (adapter === "all" || template.adapter === adapter) &&
      (!query ||
        `${template.name} ${template.description ?? ""} ${getCliBrand(template.adapter).label}`
          .toLowerCase()
          .includes(query)),
  );
  const matches = (template: Template, value: string) =>
    value === "all" ||
    (value === "builtin" ? builtin(template) : !builtin(template));
  const filtered = base.filter((template) => matches(template, kind));
  const groups = [
    {
      label: pick("使用中", "使用中", "In use"),
      items: filtered.filter((template) => (template.usageCount ?? 0) > 0),
    },
    {
      label: pick("未关联项目", "未關聯專案", "Not used in projects"),
      items: filtered.filter((template) => !(template.usageCount ?? 0)),
    },
  ];
  return (
    <aside
      aria-label={pick("模板库", "範本庫", "Template library")}
      className="flex min-h-0 max-h-80 flex-col border-b border-border lg:max-h-none lg:border-b-0 lg:border-r"
    >
      <search
        className="flex shrink-0 flex-col gap-3 border-b border-border/70 p-4"
        aria-label={pick("筛选模板", "篩選範本", "Filter templates")}
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <label className="sr-only" htmlFor="template-search">
            {pick("搜索模板", "搜尋範本", "Search templates")}
          </label>
          <Input
            id="template-search"
            name="q"
            type="search"
            className="pl-9"
            autoComplete="off"
            spellCheck={false}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={pick("搜索模板…", "搜尋範本…", "Search templates…")}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select
            aria-label={pick("CLI 筛选", "CLI 篩選", "CLI filter")}
            className="min-w-0 rounded-md border border-input bg-background px-2 py-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
            value={adapter}
            onChange={(event) => setAdapter(event.target.value)}
          >
            <option value="all">
              {pick("全部 CLI", "全部 CLI", "All CLIs")}
            </option>
            {adapters.map((value) => (
              <option key={value} value={value}>
                {getCliBrand(value).label}
              </option>
            ))}
          </select>
          <select
            aria-label={t("common.visibility")}
            className="min-w-0 rounded-md border border-input bg-background px-2 py-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
            value={visibility}
            onChange={(event) =>
              setVisibility(event.target.value as VisibilityFilter)
            }
          >
            <option value="all">{t("visibility.all")}</option>
            {visibilityOptions.map((value) => (
              <option key={value} value={value}>
                {t(visibilityLabelKey(value))}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="flex flex-wrap gap-1">
          <legend className="sr-only">
            {pick("模板类型", "範本類型", "Template type")}
          </legend>
          {[
            ["all", pick("全部", "全部", "All")],
            ["builtin", pick("内置", "內建", "Built-in")],
            ["custom", pick("自定义", "自訂", "Custom")],
          ].map(([value, label]) => (
            <label key={value} className="relative cursor-pointer">
              <input
                type="radio"
                name="template-kind"
                className="template-filter sr-only"
                value={value}
                checked={kind === value}
                onChange={() => setKind(value!)}
              />
              <span className="flex items-center gap-1.5 rounded-full border border-transparent px-2 py-1 text-[11px] text-muted-foreground">
                {label}
                <span className="tabular-nums opacity-70">
                  {base.filter((template) => matches(template, value!)).length}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      </search>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <QueryState
          isLoading={loading}
          isError={error}
          isEmpty={!filtered.length}
          onRetry={onRetry}
          loading={
            <p
              role="status"
              className="p-6 text-center text-sm text-muted-foreground"
            >
              {t("templates.loading")}
            </p>
          }
          empty={
            <div className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
              <Search className="size-6" />
              <p>
                {templates.length
                  ? pick(
                      "没有匹配的模板",
                      "沒有相符的範本",
                      "No matching templates",
                    )
                  : t("templates.emptyTitle")}
              </p>
              {templates.length ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSearch("");
                    setAdapter("all");
                    setVisibility("all");
                    setKind("all");
                  }}
                >
                  {pick("清除筛选", "清除篩選", "Clear filters")}
                </Button>
              ) : null}
            </div>
          }
        >
          {groups.map((group) =>
            group.items.length ? (
              <div key={group.label} className="mb-3 flex flex-col gap-1">
                <h2 className="flex items-center justify-between px-3 py-2 text-[11px] font-medium text-muted-foreground">
                  <span>{group.label}</span>
                  <span className="tabular-nums">{group.items.length}</span>
                </h2>
                <ul className="flex flex-col gap-1">
                  {group.items.map((template) => (
                    <li key={template.id}>
                      <button
                        type="button"
                        id={`template-select-${template.id}`}
                        aria-pressed={selectedId === template.id}
                        onClick={() => onSelect(template.id)}
                        className={cn(
                          "template-library-row flex w-full items-start gap-3 rounded-md border border-transparent px-3 py-2.5 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring",
                          selectedId === template.id &&
                            "border-brand/30 bg-brand/10",
                        )}
                      >
                        <FileCode2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="truncate text-sm font-medium">
                            {template.name}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {template.adapter
                              ? getCliBrand(template.adapter).shortLabel
                              : pick(
                                  "未指定 CLI",
                                  "未指定 CLI",
                                  "CLI unspecified",
                                )}{" "}
                            · v{template.version ?? "1.0.0"}
                          </span>
                        </span>
                        {builtin(template) ? (
                          <LockKeyhole
                            aria-label={t("templates.builtin")}
                            className="mt-1 size-3 shrink-0 text-muted-foreground"
                          />
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </QueryState>
      </div>
      <div
        className="shrink-0 border-t border-border/70 px-4 py-3 text-xs tabular-nums text-muted-foreground"
        role="status"
      >
        {filtered.length} / {templates.length}{" "}
        {pick("个模板", "個範本", "templates")}
      </div>
    </aside>
  );
}
