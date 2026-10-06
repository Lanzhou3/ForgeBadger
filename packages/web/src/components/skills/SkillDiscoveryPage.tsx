"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Search, ExternalLink, Github } from "lucide-react";
import { useTrilingual } from "@/hooks/use-trilingual";
import {
  bootstrapSkillRegistry,
  searchSkillRegistry,
  type PreviewInput,
} from "@/lib/skill-registry-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkillNavigation } from "./SkillNavigation";
import { SkillPackageReview } from "./SkillPackageReview";

export function SkillDiscoveryPage() {
  const pick = useTrilingual();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [provider, setProvider] = useState("all");
  const [page, setPage] = useState(0);
  const [includeSkillsSh, setIncludeSkillsSh] = useState(false);
  const [review, setReview] = useState<PreviewInput | null>(null);
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
  useEffect(() => {
    if (bootstrap.isSuccess) void results.refetch();
  }, [bootstrap.isSuccess, results.refetch]); // refresh once after background sources are scheduled
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 pt-16 md:p-6">
      <div>
        <h1 className="text-xl font-semibold">
          {pick("发现 Skills", "發現 Skills", "Discover Skills")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {pick(
            "搜索社区 Skill，审阅完整资源包，再选择项目使用。",
            "搜尋社群 Skill，審閱完整資源包，再選擇專案使用。",
            "Search community Skills, inspect every file, and choose where to use them.",
          )}
        </p>
      </div>
      <SkillNavigation />
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-0 flex-1 basis-64">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              aria-label={pick("搜索 Skills", "搜尋 Skills", "Search Skills")}
              placeholder={pick(
                "搜索 React、testing、code review…",
                "搜尋 React、testing、code review…",
                "Try React, testing, code review…",
              )}
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label={pick("来源筛选", "來源篩選", "Source filter")}
            className="rounded-md border border-input bg-background px-3 text-sm"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">{pick("全部来源", "全部來源", "All sources")}</option>
            <option value="github">GitHub</option>
            <option value="clawhub">ClawHub</option>
            {includeSkillsSh ? (
              <option value="skills-sh">skills.sh</option>
            ) : null}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={includeSkillsSh}
            onChange={(e) => {
              setIncludeSkillsSh(e.target.checked);
              setPage(0);
              if (!e.target.checked && provider === "skills-sh")
                setProvider("all");
            }}
          />
          {pick(
            "同时搜索 skills.sh（实验性兼容来源）",
            "同時搜尋 skills.sh（實驗性相容來源）",
            "Include skills.sh (experimental compatibility source)",
          )}
        </label>
        <p className="text-xs text-muted-foreground">
          {pick(
            "GitHub 搜索已同步仓库；输入至少 2 个字符后，同时检索 ClawHub。",
            "GitHub 搜尋已同步倉庫；輸入至少 2 個字元後，同時檢索 ClawHub。",
            "GitHub searches synced repositories. Enter at least 2 characters to also search ClawHub.",
          )}
        </p>
      </div>
      <details className="rounded-lg border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium">
          {pick("从 GitHub 仓库安装", "從 GitHub 倉庫安裝", "Install from a GitHub repository")}
        </summary>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
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
          <Input
            required
            aria-label={pick("仓库", "倉庫", "Repository")}
            placeholder="owner/repo"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
          />
          <Input
            required
            aria-label={pick("Skill 路径", "Skill 路徑", "Skill path")}
            placeholder="skills/review/SKILL.md"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
          <Input
            aria-label={pick("分支或提交", "分支或提交", "Branch or commit")}
            placeholder={pick(
              "分支 / 提交（可选）",
              "分支 / 提交（可選）",
              "Branch / commit (optional)",
            )}
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
          <Button type="submit" variant="outline">
            {pick("预览资源包", "預覽資源包", "Preview package")}
          </Button>
        </form>
      </details>
      {bootstrap.error ? (
        <p role="alert" className="text-sm text-destructive">
          {bootstrap.error.message}{" "}
          <Button variant="link" onClick={() => bootstrap.mutate()}>
            {pick("重试", "重試", "Retry")}
          </Button>
        </p>
      ) : null}
      <div
        aria-live="polite"
        className="space-y-2 text-xs text-muted-foreground"
      >
        {results.data?.statuses.map((status) => (
          <p
            key={status.provider}
            className={
              status.status === "error"
                ? "text-amber-600 dark:text-amber-300"
                : ""
            }
          >
            {status.provider}:{" "}
            {status.status === "syncing"
              ? pick("仓库同步中…", "倉庫同步中…", "Synchronizing repositories…")
              : status.status === "error"
                ? pick("暂不可用，其他来源仍可使用", "暫不可用，其他來源仍可使用", "Unavailable; other sources remain usable")
                : pick("可用", "可用", "Available")}
            {status.message ? ` · ${status.message}` : ""}
          </p>
        ))}
      </div>
      {results.error ? (
        <div
          role="alert"
          className="rounded-lg border border-border p-5 text-sm"
        >
          {results.error.message}
          <Button variant="link" onClick={() => results.refetch()}>
            {pick("重试", "重試", "Retry")}
          </Button>
        </div>
      ) : results.isPending ? (
        <p role="status" className="py-12 text-center text-muted-foreground">
          {pick("正在搜索…", "正在搜尋…", "Searching…")}
        </p>
      ) : results.data?.items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p>{pick("暂时没有匹配的 Skill", "暫時沒有匹配的 Skill", "No matching Skills yet")}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {pick(
              "尝试其他关键词，或在来源管理中同步仓库。",
              "嘗試其他關鍵詞，或在來源管理中同步倉庫。",
              "Try another keyword or sync repositories in Sources.",
            )}
          </p>
          <Button asChild variant="link">
            <Link href="/skills/sources">
              {pick("管理来源", "管理來源", "Manage sources")}
            </Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {results.data?.items.map((item) => (
            <article
              key={item.id}
              className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="break-words font-medium">{item.name}</h2>
                <span className="shrink-0 rounded border border-border/70 px-2 py-0.5 text-xs text-muted-foreground">
                  {item.provider}
                </span>
              </div>
              <p className="line-clamp-3 flex-1 text-sm text-muted-foreground">
                {item.description ||
                  pick(
                    "预览资源包以查看说明。",
                    "預覽資源包以查看說明。",
                    "Preview the package to read its description.",
                  )}
              </p>
              <div className="flex items-center justify-between gap-3">
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Github className="size-3 shrink-0" />
                  <span className="truncate">{item.sourceLabel}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
                {item.installedSkillId ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href="/skills">{pick("已安装", "已安裝", "Installed")}</Link>
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setReview({ locator: item.locator })}
                  >
                    {pick("预览安装", "預覽安裝", "Preview & install")}
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {results.data?.total ?? 0} {pick("项结果", "項結果", "results")}
          {results.isFetching ? ` · ${pick("正在刷新…", "正在重新整理…", "Refreshing…")}` : ""}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            {pick("上一页", "上一頁", "Previous")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!results.data?.hasMore}
            onClick={() => setPage((p) => p + 1)}
          >
            {pick("下一页", "下一頁", "Next")}
          </Button>
        </div>
      </div>
      {review ? (
        <SkillPackageReview
          key={JSON.stringify(review)}
          input={review}
          onClose={() => setReview(null)}
        />
      ) : null}
    </div>
  );
}
