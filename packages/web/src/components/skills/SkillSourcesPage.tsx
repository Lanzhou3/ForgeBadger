"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "@/hooks/use-language";
import { useTrilingual } from "@/hooks/use-trilingual";
import {
  listSkillRegistrySources,
  refreshSkillRegistrySource,
  removeSkillRegistrySource,
} from "@/lib/skill-registry-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkillNavigation } from "./SkillNavigation";

export function SkillSourcesPage() {
  const { language } = useLanguage();
  const pick = useTrilingual();
  const client = useQueryClient();
  const [repo, setRepo] = useState("");
  const sources = useQuery({
    queryKey: ["skill-registry-sources"],
    queryFn: listSkillRegistrySources,
    refetchInterval: (query) =>
      query.state.data?.sources.some((s) => s.status === "syncing")
        ? 2500
        : false,
  });
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["skill-registry-sources"] }),
      client.invalidateQueries({ queryKey: ["skill-search"] }),
    ]);
  const add = useMutation({
    mutationFn: refreshSkillRegistrySource,
    onSuccess: () => {
      setRepo("");
      return refresh();
    },
    onSettled: () => refresh(),
  });
  const remove = useMutation({
    mutationFn: removeSkillRegistrySource,
    onSuccess: refresh,
  });
  const busy = add.isPending || remove.isPending;
  const status = (value: string) =>
    value === "active"
      ? pick("已同步", "已同步", "Synced")
      : value === "syncing"
        ? pick("同步中…", "同步中…", "Synchronizing…")
        : value === "disabled"
          ? pick("已停用", "已停用", "Disabled")
          : value.startsWith("partial:")
            ? pick(
                `部分可用 · 跳过 ${value.split(":")[1]} 项`,
                `部分可用 · 略過 ${value.split(":")[1]} 項`,
                `Partial · ${value.split(":")[1]} skipped`,
              )
            : value === "error"
              ? pick("同步失败 · 保留原结果", "同步失敗 · 保留原結果", "Sync failed · previous results retained")
              : value;
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 pt-16 md:p-6">
      <div>
        <h1 className="text-xl font-semibold">
          {pick("Skill 来源管理", "Skill 來源管理", "Skill sources")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {pick(
            "同步公开 GitHub 仓库；ClawHub 在搜索时实时检索。",
            "同步公開 GitHub 倉庫；ClawHub 在搜尋時即時檢索。",
            "Sync public GitHub repositories. ClawHub is searched on demand.",
          )}
        </p>
      </div>
      <SkillNavigation />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate(repo.trim());
        }}
        className="flex flex-wrap gap-3 rounded-lg border border-border bg-card p-4"
      >
        <Input
          required
          className="min-w-0 flex-1 basis-64"
          aria-label={pick("仓库来源", "倉庫來源", "Repository source")}
          placeholder="owner/repo"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
        />
        <Button disabled={busy} type="submit">
          {add.isPending
            ? pick("同步中…", "同步中…", "Synchronizing…")
            : pick("添加并同步", "新增並同步", "Add & sync")}
        </Button>
      </form>
      {add.error || remove.error ? (
        <p role="alert" className="text-sm text-destructive">
          {(add.error ?? remove.error)?.message}
        </p>
      ) : null}
      {sources.error ? (
        <div role="alert">
          {sources.error.message}
          <Button variant="link" onClick={() => sources.refetch()}>
            {pick("重试", "重試", "Retry")}
          </Button>
        </div>
      ) : sources.isPending ? (
        <p role="status">{pick("加载中…", "載入中…", "Loading…")}</p>
      ) : (
        <div className="divide-y divide-border/70 rounded-lg border border-border bg-card">
          {sources.data?.sources.map((source) => (
            <div
              key={source.sourceId}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <a
                  href={source.url}
                  rel="noreferrer"
                  target="_blank"
                  className="break-all text-sm font-medium hover:underline"
                >
                  {source.label}
                </a>
                <p className="mt-1 text-xs text-muted-foreground">
                  {status(source.status)}
                  {source.lastRefreshedAt
                    ? ` · ${new Date(source.lastRefreshedAt).toLocaleString(language)}`
                    : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || source.status === "syncing"}
                  onClick={() =>
                    add.mutate(source.sourceId.replace(/^github:/, ""))
                  }
                >
                  {source.status === "disabled"
                    ? pick("启用并同步", "啟用並同步", "Enable & sync")
                    : pick("刷新", "重新整理", "Refresh")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={
                    busy ||
                    source.status === "syncing" ||
                    source.status === "disabled"
                  }
                  onClick={() => remove.mutate(source.sourceId)}
                >
                  {pick("停用", "停用", "Disable")}
                </Button>
              </div>
            </div>
          ))}
          {!sources.data?.sources.length ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              {pick(
                "进入「发现」加载精选来源，或在上方添加仓库。",
                "進入「發現」載入精選來源，或在上方新增倉庫。",
                "Visit Discover to load curated sources, or add a repository above.",
              )}
            </p>
          ) : null}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {pick(
          "停用来源会移除其搜索结果，保留已安装的 Skill。来源提供指令与资源，使用前请审阅。",
          "停用來源會移除其搜尋結果，保留已安裝的 Skill。來源提供指令與資源，使用前請審閱。",
          "Disabling a source removes its search results and keeps installed Skills. Sources publish instructions and resources; review them before use.",
        )}
      </p>
    </div>
  );
}
