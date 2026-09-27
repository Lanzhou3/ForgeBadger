"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "@/hooks/use-language";
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
  const en = language === "en";
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
      ? en
        ? "Synced"
        : "已同步"
      : value === "syncing"
        ? en
          ? "Synchronizing…"
          : "同步中…"
        : value === "disabled"
          ? en
            ? "Disabled"
            : "已停用"
          : value.startsWith("partial:")
            ? en
              ? `Partial · ${value.split(":")[1]} skipped`
              : `部分可用 · 跳过 ${value.split(":")[1]} 项`
            : value === "error"
              ? en
                ? "Sync failed · previous results retained"
                : "同步失败 · 保留原结果"
              : value;
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 pt-16 md:p-6">
      <div>
        <h1 className="text-xl font-semibold">
          {en ? "Skill sources" : "Skill 来源管理"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {en
            ? "Sync public GitHub repositories. ClawHub is searched on demand."
            : "同步公开 GitHub 仓库；ClawHub 在搜索时实时检索。"}
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
          aria-label={en ? "Repository source" : "仓库来源"}
          placeholder="owner/repo"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
        />
        <Button disabled={busy} type="submit">
          {add.isPending
            ? en
              ? "Synchronizing…"
              : "同步中…"
            : en
              ? "Add & sync"
              : "添加并同步"}
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
            {en ? "Retry" : "重试"}
          </Button>
        </div>
      ) : sources.isPending ? (
        <p role="status">{en ? "Loading…" : "加载中…"}</p>
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
                    ? en
                      ? "Enable & sync"
                      : "启用并同步"
                    : en
                      ? "Refresh"
                      : "刷新"}
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
                  {en ? "Disable" : "停用"}
                </Button>
              </div>
            </div>
          ))}
          {!sources.data?.sources.length ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              {en
                ? "Visit Discover to load curated sources, or add a repository above."
                : "进入「发现」加载精选来源，或在上方添加仓库。"}
            </p>
          ) : null}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {en
          ? "Disabling a source removes its search results and keeps installed Skills. Sources publish instructions and resources; review them before use."
          : "停用来源会移除其搜索结果，保留已安装的 Skill。来源提供指令与资源，使用前请审阅。"}
      </p>
    </div>
  );
}
