"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Search,
  ExternalLink,
  Github,
  ArrowUpRight,
  FileCode2,
  Plus,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { useTrilingual } from "@/hooks/use-trilingual";
import {
  bootstrapSkillRegistry,
  searchSkillRegistry,
  type PreviewInput,
} from "@/lib/skill-registry-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SkillWorkspace } from "./SkillWorkspace";
import { SkillPackageReview } from "./SkillPackageReview";
import { SkillInfo } from "./SkillInfo";

export function SkillDiscoveryPage() {
  const pick = useTrilingual();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [provider, setProvider] = useState("all");
  const [page, setPage] = useState(0);
  const [includeSkillsSh, setIncludeSkillsSh] = useState(false);
  const [review, setReview] = useState<PreviewInput | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [repo, setRepo] = useState("");
  const [path, setPath] = useState("");
  const [ref, setRef] = useState("");
  const bootstrap = useMutation({ mutationFn: bootstrapSkillRegistry });
  const { mutate: bootstrapSources } = bootstrap;
  useEffect(() => {
    bootstrapSources();
  }, [bootstrapSources]);
  useEffect(() => {
    const timeout = setTimeout(() => {
      setQ(search.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);
  const results = useQuery({
    queryKey: ["skill-search", q, provider, page, includeSkillsSh],
    queryFn: ({ signal }) =>
      searchSkillRegistry({ q, provider, page, includeSkillsSh }, signal),
    refetchInterval: (query) =>
      query.state.data?.statuses.some((item) => item.status === "syncing")
        ? 2500
        : false,
  });
  const { refetch } = results;
  useEffect(() => {
    if (bootstrap.isSuccess) void refetch();
  }, [bootstrap.isSuccess, refetch]);
  const notices =
    results.data?.statuses.filter(
      (item) => item.status === "error" || item.status === "syncing",
    ) ?? [];
  return (
    <SkillWorkspace
      title={pick("发现 Skills", "探索 Skills", "Discover Skills")}
      actions={
        <Button
          id="skill-repository-import"
          size="sm"
          variant="outline"
          onClick={() => setImportOpen(true)}
        >
          <Plus />
          {pick("从仓库导入", "從倉庫匯入", "Import repository")}
        </Button>
      }
    >
      <search
        aria-label={pick(
          "搜索社区 Skills",
          "搜尋社群 Skills",
          "Search community Skills",
        )}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-1 basis-64">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
            <label htmlFor="discover-search" className="sr-only">
              {pick("搜索 Skills", "搜尋 Skills", "Search Skills")}
            </label>
            <Input
              id="discover-search"
              name="q"
              type="search"
              autoComplete="off"
              spellCheck={false}
              placeholder={pick(
                "搜索 React、testing、code review…",
                "搜尋 React、testing、code review…",
                "Search React, testing, code review…",
              )}
              className="h-10 pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <select
            aria-label={pick("来源筛选", "來源篩選", "Source filter")}
            className="h-10 min-w-36 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value);
              setPage(0);
            }}
          >
            <option value="all">
              {pick("全部来源", "全部來源", "All sources")}
            </option>
            <option value="github">GitHub</option>
            <option value="clawhub">ClawHub</option>
            {includeSkillsSh ? (
              <option value="skills-sh">skills.sh</option>
            ) : null}
          </select>
          <SkillInfo label={pick("搜索范围", "搜尋範圍", "Search coverage")}>
            {pick(
              "GitHub 搜索已同步仓库；输入至少 2 个字符后同时检索 ClawHub。",
              "GitHub 搜尋已同步倉庫；輸入至少 2 個字元後同時檢索 ClawHub。",
              "GitHub searches synced repositories. Enter at least 2 characters to also search ClawHub.",
            )}
          </SkillInfo>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span role="status">
            {results.data?.total ?? 0} {pick("项结果", "項結果", "results")}
            {results.isFetching
              ? ` · ${pick("搜索中…", "搜尋中…", "Searching…")}`
              : ""}
          </span>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              name="include-skills-sh"
              className="size-3.5 accent-[hsl(var(--brand))]"
              checked={includeSkillsSh}
              onChange={(event) => {
                setIncludeSkillsSh(event.target.checked);
                setPage(0);
                if (!event.target.checked && provider === "skills-sh")
                  setProvider("all");
              }}
            />
            {pick(
              "包含 skills.sh（实验性）",
              "包含 skills.sh（實驗性）",
              "Include skills.sh (experimental)",
            )}
          </label>
        </div>
      </search>
      {bootstrap.error ? (
        <div role="alert" className="text-sm text-destructive">
          {bootstrap.error.message}
          <Button variant="link" onClick={() => bootstrap.mutate()}>
            {pick("重试", "重試", "Retry")}
          </Button>
        </div>
      ) : null}
      {notices.length ? (
        <div className="flex flex-col gap-2 text-xs" aria-live="polite">
          {notices.map((notice) => (
            <div
              key={notice.provider}
              className="flex items-center gap-2 text-muted-foreground"
            >
              {notice.status === "error" ? (
                <AlertTriangle className="size-3.5 text-amber-500" />
              ) : (
                <RefreshCw className="size-3.5 motion-safe:animate-spin" />
              )}
              <span>
                {notice.provider}:{" "}
                {notice.status === "error"
                  ? pick(
                      "暂不可用，其他来源仍可使用",
                      "暫不可用，其他來源仍可使用",
                      "Unavailable; other sources remain usable",
                    )
                  : pick("同步中…", "同步中…", "Synchronizing…")}
              </span>
              {notice.message ? (
                <SkillInfo
                  label={`${notice.provider} ${pick("详情", "詳情", "details")}`}
                >
                  {notice.message}
                </SkillInfo>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {results.error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 p-5 text-sm"
        >
          {results.error.message}
          <Button variant="link" onClick={() => refetch()}>
            {pick("重试", "重試", "Retry")}
          </Button>
        </div>
      ) : results.isPending ? (
        <p
          role="status"
          className="py-16 text-center text-sm text-muted-foreground"
        >
          {pick("正在搜索…", "正在搜尋…", "Searching…")}
        </p>
      ) : !results.data?.items.length ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border py-16">
          <Search className="size-7 text-muted-foreground" />
          <h2 className="text-sm font-medium">
            {pick("没有匹配的 Skill", "沒有相符的 Skill", "No matching Skills")}
          </h2>
          <div className="flex gap-2">
            {search ? (
              <Button variant="outline" onClick={() => setSearch("")}>
                {pick("清除搜索", "清除搜尋", "Clear search")}
              </Button>
            ) : null}
            <Button variant="outline" asChild>
              <Link href="/skills/sources">
                {pick("管理来源", "管理來源", "Manage sources")}
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {results.data.items.map((item) => (
            <article
              key={item.id}
              className="skills-result skills-enter flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/30 text-muted-foreground">
                    <FileCode2 className="size-4" />
                  </span>
                  <h2 className="truncate text-sm font-semibold">
                    {item.name}
                  </h2>
                </div>
                <span className="text-xs text-muted-foreground">
                  {item.provider === "github"
                    ? "GitHub"
                    : item.provider === "clawhub"
                      ? "ClawHub"
                      : item.provider}
                </span>
              </div>
              {item.description ? (
                <p className="line-clamp-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              ) : null}
              <div className="mt-auto flex items-center justify-between gap-3 border-t border-border/70 pt-3">
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Github className="size-3.5 shrink-0" />
                  <span className="truncate">{item.sourceLabel}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
                {item.installedSkillId ? (
                  <Button asChild size="sm" variant="ghost">
                    <Link href="/skills">
                      {pick("已安装", "已安裝", "Installed")}
                    </Link>
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setReview({ locator: item.locator })}
                  >
                    {pick("预览安装", "預覽安裝", "Preview & install")}
                    <ArrowUpRight />
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {page > 0 || results.data?.hasMore ? (
        <nav
          aria-label={pick("搜索结果分页", "搜尋結果分頁", "Search pages")}
          className="flex items-center justify-end gap-2"
        >
          <Button
            variant="outline"
            size="sm"
            disabled={!page}
            onClick={() => setPage((value) => value - 1)}
          >
            {pick("上一页", "上一頁", "Previous")}
          </Button>
          <span className="px-2 text-xs text-muted-foreground">{page + 1}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!results.data?.hasMore}
            onClick={() => setPage((value) => value + 1)}
          >
            {pick("下一页", "下一頁", "Next")}
          </Button>
        </nav>
      ) : null}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent
          className="skills-dialog"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!review)
              document.getElementById("skill-repository-import")?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {pick(
                "从 GitHub 仓库导入",
                "從 GitHub 倉庫匯入",
                "Import from GitHub",
              )}
            </DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              setImportOpen(false);
              setReview({
                locator: {
                  kind: "github",
                  repo: repo.trim(),
                  path: path.trim(),
                  ...(ref.trim() ? { ref: ref.trim() } : {}),
                },
              });
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="import-repo">
                {pick("仓库", "倉庫", "Repository")}
              </Label>
              <Input
                id="import-repo"
                name="repo"
                required
                placeholder="owner/repo"
                autoCapitalize="none"
                spellCheck={false}
                value={repo}
                onChange={(event) => setRepo(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="import-path">
                {pick("Skill 路径", "Skill 路徑", "Skill path")}
              </Label>
              <Input
                id="import-path"
                name="path"
                required
                placeholder="skills/review/SKILL.md"
                spellCheck={false}
                value={path}
                onChange={(event) => setPath(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="import-ref">
                {pick(
                  "分支或提交（可选）",
                  "分支或提交（選填）",
                  "Branch or commit (optional)",
                )}
              </Label>
              <Input
                id="import-ref"
                name="ref"
                value={ref}
                onChange={(event) => setRef(event.target.value)}
              />
            </div>
            <Button type="submit" variant="brand">
              {pick("预览资源包", "預覽資源包", "Preview package")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      {review ? (
        <SkillPackageReview
          key={JSON.stringify(review)}
          input={review}
          onClose={() => setReview(null)}
        />
      ) : null}
    </SkillWorkspace>
  );
}
