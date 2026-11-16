"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  FileCode2,
  Github,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { QueryState } from "@/components/ui/query-state";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  checkAllSkillUpdates,
  checkSkillUpdate,
  deleteSkill,
  listSkills,
  parseSkillRemoteProvenance,
  syncLocalSkills,
  toggleSkill,
  type Skill,
} from "@/lib/api";
import {
  filterByVisibility,
  normalizeVisibility,
  visibilityLabelKey,
  visibilityOptions,
  type VisibilityFilter,
} from "@/lib/visibility";
import { useLanguage } from "@/hooks/use-language";
import { useTrilingual } from "@/hooks/use-trilingual";
import { SkillWorkspace } from "@/components/skills/SkillWorkspace";
import { SkillScanStatus } from "@/components/skills/SkillScanStatus";
import { SkillEditor } from "@/components/skills/SkillEditor";
import { SkillDetails } from "@/components/skills/SkillDetails";
import { SkillInfo } from "@/components/skills/SkillInfo";
import { SkillPackageReview } from "@/components/skills/SkillPackageReview";
import {
  hasSkillUpdate,
  matchesSkillStatus,
  skillSource,
  type SkillStatus,
} from "@/components/skills/skill-library";

const PAGE_SIZE = 20;

export default function SkillsPage() {
  const { t } = useLanguage();
  const pick = useTrilingual();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const [source, setSource] = useState("all");
  const [visibility, setVisibility] = useState<VisibilityFilter>("all");
  const [status, setStatus] = useState<SkillStatus>("all");
  const [page, setPage] = useState(0);
  const [editor, setEditor] = useState<{ skill: Skill | null } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [updateId, setUpdateId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Skill | null>(null);
  const [actionError, setActionError] = useState("");
  const query = useQuery({ queryKey: ["skills"], queryFn: listSkills });
  const skills = query.data?.skills ?? [];
  const detail = skills.find((skill) => skill.id === detailId);
  const sourceOptions = [...new Set(skills.map(skillSource))];
  const sourceLabel = (value: string) =>
    value === "github"
      ? "GitHub"
      : value === "clawhub"
        ? "ClawHub"
        : value === "local"
          ? "Local"
          : value;
  const base = filterByVisibility(skills, visibility).filter(
    (skill) =>
      (source === "all" || skillSource(skill) === source) &&
      (!deferredSearch ||
        `${skill.name} ${skill.description ?? ""} ${skillSource(skill)}`
          .toLowerCase()
          .includes(deferredSearch)),
  );
  const filtered = base.filter((skill) => matchesSkillStatus(skill, status));
  const lastPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = filtered.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const invalidate = () => client.invalidateQueries({ queryKey: ["skills"] });
  const fail = (error: Error) => setActionError(error.message);
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      toggleSkill(id, enabled),
    onMutate: async ({ id, enabled }) => {
      await client.cancelQueries({ queryKey: ["skills"] });
      const previous = client.getQueryData<
        Awaited<ReturnType<typeof listSkills>>
      >(["skills"]);
      client.setQueryData<Awaited<ReturnType<typeof listSkills>>>(
        ["skills"],
        (old) =>
          old
            ? {
                ...old,
                skills: old.skills.map((skill) =>
                  skill.id === id ? { ...skill, isEnabled: enabled } : skill,
                ),
              }
            : old,
      );
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) client.setQueryData(["skills"], context.previous);
      fail(error);
    },
    onSettled: invalidate,
  });
  const sync = useMutation({
    mutationFn: syncLocalSkills,
    onSuccess: async () => {
      await invalidate();
      toast.success(
        pick("本地同步完成", "本機同步完成", "Local sync complete"),
      );
    },
    onError: fail,
  });
  const check = useMutation({
    mutationFn: checkSkillUpdate,
    onSuccess: invalidate,
    onError: fail,
  });
  const checkAll = useMutation({
    mutationFn: checkAllSkillUpdates,
    onSuccess: async (result) => {
      await invalidate();
      if (!result.results.some((item) => item.error))
        toast.success(
          pick("更新检查完成", "更新檢查完成", "Update check complete"),
        );
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: deleteSkill,
    onSuccess: async () => {
      setDeleting(null);
      await invalidate();
    },
    onError: (error) => {
      setDeleting(null);
      fail(error);
    },
  });
  const filteredActive = Boolean(
    search || source !== "all" || visibility !== "all" || status !== "all",
  );
  function resetFilters() {
    setSearch("");
    setSource("all");
    setVisibility("all");
    setStatus("all");
    setPage(0);
  }
  const statusOptions: Array<{ value: SkillStatus; label: string }> = [
    { value: "all", label: pick("全部", "全部", "All") },
    { value: "enabled", label: pick("已启用", "已啟用", "Enabled") },
    { value: "disabled", label: pick("未启用", "未啟用", "Disabled") },
    { value: "updates", label: pick("可更新", "可更新", "Updates") },
  ];

  return (
    <SkillWorkspace
      title="Skills"
      count={query.data ? skills.length : undefined}
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={sync.isPending}
            onClick={() => sync.mutate()}
          >
            <RefreshCw
              className={sync.isPending ? "motion-safe:animate-spin" : ""}
            />
            {pick("同步本地", "同步本機", "Sync local")}
          </Button>
          <Button
            id="skill-create"
            variant="brand"
            size="sm"
            onClick={() => setEditor({ skill: null })}
          >
            <Plus />
            {pick("新建 Skill", "新增 Skill", "New Skill")}
          </Button>
        </>
      }
    >
      {query.data?.discovery ? (
        <SkillScanStatus discovery={query.data.discovery} />
      ) : null}
      {actionError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 px-4 py-3 text-sm text-destructive"
        >
          <span>{actionError}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("common.close")}
            onClick={() => setActionError("")}
          >
            <X />
          </Button>
        </div>
      ) : null}
      {checkAll.data?.results
        .filter((item) => item.error)
        .map((item) => (
          <p
            role="alert"
            key={item.skillId}
            className="text-sm text-destructive"
          >
            {item.name}: {item.error}
          </p>
        ))}
      <search
        className="flex flex-col gap-4"
        aria-label={pick("筛选 Skills", "篩選 Skills", "Filter Skills")}
      >
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-1 basis-64">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
            <label htmlFor="skill-search" className="sr-only">
              {pick("搜索 Skills", "搜尋 Skills", "Search Skills")}
            </label>
            <Input
              id="skill-search"
              name="q"
              type="search"
              autoComplete="off"
              spellCheck={false}
              placeholder={pick(
                "搜索名称、描述…",
                "搜尋名稱、描述…",
                "Search name or description…",
              )}
              className="h-10 pl-9"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
            />
          </div>
          <select
            aria-label={pick("来源筛选", "來源篩選", "Source filter")}
            className="h-10 min-w-32 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring sm:flex-none"
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setPage(0);
            }}
          >
            <option value="all">{t("skills.sourceAll")}</option>
            {sourceOptions.map((value) => (
              <option key={value} value={value}>
                {sourceLabel(value)}
              </option>
            ))}
          </select>
          <select
            aria-label={t("common.visibility")}
            className="h-10 min-w-32 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring sm:flex-none"
            value={visibility}
            onChange={(event) => {
              setVisibility(event.target.value as VisibilityFilter);
              setPage(0);
            }}
          >
            <option value="all">{t("visibility.all")}</option>
            {visibilityOptions.map((value) => (
              <option key={value} value={value}>
                {t(visibilityLabelKey(value))}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <fieldset className="flex max-w-full flex-nowrap gap-1 overflow-x-auto pb-1">
            <legend className="sr-only">
              {pick("Skill 状态", "Skill 狀態", "Skill status")}
            </legend>
            {statusOptions.map((option) => (
              <label
                key={option.value}
                className="relative shrink-0 cursor-pointer"
              >
                <input
                  className="skills-filter sr-only"
                  type="radio"
                  name="skill-status"
                  value={option.value}
                  checked={status === option.value}
                  onChange={() => {
                    setStatus(option.value);
                    setPage(0);
                  }}
                />
                <span className="flex items-center gap-2 rounded-full border border-transparent px-3 py-1.5 text-xs text-muted-foreground">
                  <span>{option.label}</span>
                  <span className="tabular-nums opacity-70">
                    {
                      base.filter((skill) =>
                        matchesSkillStatus(skill, option.value),
                      ).length
                    }
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          {skills.some((skill) => parseSkillRemoteProvenance(skill)) ? (
            <Button
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex"
              disabled={checkAll.isPending}
              onClick={() => checkAll.mutate()}
            >
              <RefreshCw
                className={checkAll.isPending ? "motion-safe:animate-spin" : ""}
              />
              {t("skills.checkAllUpdates")}
            </Button>
          ) : null}
        </div>
      </search>
      <QueryState
        isLoading={query.isPending}
        isError={Boolean(query.error && !query.data)}
        isEmpty={!filtered.length}
        onRetry={() => void query.refetch()}
        empty={
          <div className="skills-enter flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
            <FileCode2 className="size-8 text-muted-foreground" />
            <h2 className="text-base font-medium">
              {filteredActive
                ? pick(
                    "没有匹配的 Skill",
                    "沒有相符的 Skill",
                    "No matching Skills",
                  )
                : pick("还没有 Skill", "尚無 Skill", "No Skills yet")}
            </h2>
            {filteredActive ? (
              <Button variant="outline" onClick={resetFilters}>
                {pick("清除筛选", "清除篩選", "Clear filters")}
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="brand" asChild>
                  <Link href="/skills/discover">
                    {pick("发现 Skills", "探索 Skills", "Discover Skills")}
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setEditor({ skill: null })}
                >
                  {pick("新建 Skill", "新增 Skill", "New Skill")}
                </Button>
              </div>
            )}
          </div>
        }
      >
        <div
          className="skills-enter overflow-hidden rounded-lg border border-border bg-card"
          aria-busy={query.isFetching}
        >
          <div
            aria-hidden="true"
            className="skills-row skills-list-heading border-b border-border/70 bg-muted/20 px-4 py-2 text-xs text-muted-foreground"
          >
            <span>Skill</span>
            <span className="hidden md:block">{t("skills.source")}</span>
            <span className="flex items-center gap-1">
              {pick("默认启用", "預設啟用", "Default")}
            </span>
            <span />
          </div>
          <ul className="divide-y divide-border/70">
            {visible.map((skill) => {
              const provenance = parseSkillRemoteProvenance(skill);
              return (
                <li
                  key={skill.id}
                  className="skills-row min-h-18 px-4 py-3 hover:bg-muted/30"
                >
                  <button
                    type="button"
                    id={`skill-open-${skill.id}`}
                    className="flex min-w-0 items-center gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring"
                    onClick={() => setDetailId(skill.id)}
                  >
                    <span className="hidden size-9 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/30 text-muted-foreground sm:flex">
                      <FileCode2 className="size-4" />
                    </span>
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="truncate text-sm font-medium">
                        {skill.name}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {skill.description || `v${skill.version ?? "1.0.0"}`}
                      </span>
                      <span className="text-xs text-muted-foreground md:hidden">
                        {sourceLabel(skillSource(skill))}
                      </span>
                    </span>
                  </button>
                  <span className="hidden min-w-0 flex-col gap-1 md:flex">
                    <span className="flex items-center gap-1.5 text-xs">
                      {skillSource(skill) === "github" ? (
                        <Github className="size-3.5 text-muted-foreground" />
                      ) : null}
                      {sourceLabel(skillSource(skill))}
                    </span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      v{skill.version ?? "1.0.0"} ·{" "}
                      {t(
                        visibilityLabelKey(
                          normalizeVisibility(skill.visibility),
                        ),
                      )}
                    </span>
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="hidden text-xs text-muted-foreground lg:block">
                      {skill.isEnabled
                        ? pick("已启用", "已啟用", "Enabled")
                        : pick("未启用", "未啟用", "Disabled")}
                    </span>
                    <Switch
                      checked={skill.isEnabled}
                      disabled={toggle.isPending}
                      onCheckedChange={(enabled) =>
                        toggle.mutate({ id: skill.id, enabled })
                      }
                      aria-label={`${skill.name} ${pick("默认启用", "預設啟用", "enabled by default")}`}
                    />
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    {hasSkillUpdate(skill) ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        title={t("skills.updateSkill")}
                        aria-label={`${skill.name} ${t("skills.updateSkill")}`}
                        onClick={() => setUpdateId(skill.id)}
                      >
                        <span className="text-brand">
                          {t("skills.updateSkill")}
                        </span>
                      </Button>
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${skill.name} ${pick("更多操作", "更多操作", "more actions")}`}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            onSelect={() => setDetailId(skill.id)}
                          >
                            <FileCode2 />
                            {t("skills.preview")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => setEditor({ skill })}
                          >
                            <Pencil />
                            {t("skills.editSkill")}
                          </DropdownMenuItem>
                          {provenance ? (
                            <DropdownMenuItem
                              disabled={check.isPending}
                              onSelect={() => check.mutate(skill.id)}
                            >
                              <RefreshCw />
                              {t("skills.checkUpdate")}
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setDeleting(skill)}
                          >
                            <Trash2 />
                            {t("common.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span role="status">
            {filtered.length
              ? `${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} / ${filtered.length}`
              : "0"}{" "}
            {pick("项", "項", "Skills")}
          </span>
          <div className="flex items-center gap-2">
            <SkillInfo label={pick("启用说明", "啟用說明", "About enabling")}>
              {pick(
                "默认启用供项目继承。请到项目中预览并同步配置，使变更生效。",
                "預設啟用供專案繼承。請至專案預覽並同步配置，使變更生效。",
                "Projects inherit this default. Preview and sync project configuration to activate changes.",
              )}
            </SkillInfo>
            {lastPage > 0 ? (
              <>
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label={pick("上一页", "上一頁", "Previous page")}
                  disabled={!currentPage}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ChevronLeft />
                </Button>
                <span className="px-2 tabular-nums">
                  {currentPage + 1} / {lastPage + 1}
                </span>
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label={pick("下一页", "下一頁", "Next page")}
                  disabled={currentPage === lastPage}
                  onClick={() => setPage(currentPage + 1)}
                >
                  <ChevronRight />
                </Button>
              </>
            ) : null}
          </div>
        </footer>
      </QueryState>
      {detail ? (
        <SkillDetails
          key={detail.id}
          skill={detail}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            setDetailId(null);
            setEditor({ skill: detail });
          }}
        />
      ) : null}
      {editor ? (
        <SkillEditor
          key={editor.skill?.id ?? "new"}
          skill={editor.skill}
          onClose={() => setEditor(null)}
        />
      ) : null}
      {updateId ? (
        <SkillPackageReview
          input={{ skillId: updateId }}
          onClose={() => setUpdateId(null)}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(deleting)}
        destructive
        pending={remove.isPending}
        title={t("skills.deleteConfirmTitle")}
        description={
          deleting
            ? t("skills.deleteConfirmNamed").replace("{name}", deleting.name)
            : ""
        }
        confirmLabel={t("common.delete")}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </SkillWorkspace>
  );
}
