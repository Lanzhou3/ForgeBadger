"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Github,
  Plus,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useTrilingual } from "@/hooks/use-trilingual";
import {
  listSkillRegistrySources,
  refreshSkillRegistrySource,
  removeSkillRegistrySource,
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
import { SkillInfo } from "./SkillInfo";

export function SkillSourcesPage() {
  const { language } = useLanguage();
  const pick = useTrilingual();
  const client = useQueryClient();
  const [repo, setRepo] = useState("");
  const [open, setOpen] = useState(false);
  const sources = useQuery({
    queryKey: ["skill-registry-sources"],
    queryFn: listSkillRegistrySources,
    refetchInterval: (query) =>
      query.state.data?.sources.some((source) => source.status === "syncing")
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
      setOpen(false);
    },
    onSettled: refresh,
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
              ? pick("同步失败", "同步失敗", "Sync failed")
              : value;
  return (
    <SkillWorkspace
      title={pick("Skill 来源", "Skill 來源", "Skill sources")}
      count={sources.data?.sources.length}
      actions={
        <Button
          id="skill-source-add"
          size="sm"
          variant="brand"
          onClick={() => {
            add.reset();
            setOpen(true);
          }}
        >
          <Plus />
          {pick("添加仓库", "新增倉庫", "Add repository")}
        </Button>
      }
    >
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Github className="size-4" />
          GitHub
        </h2>
        <SkillInfo label={pick("来源说明", "來源說明", "About sources")}>
          {pick(
            "同步公开 GitHub 仓库后可在「发现」中检索。ClawHub 在搜索时实时检索。停用来源仅移除搜索结果，保留已安装 Skill。",
            "同步公開 GitHub 倉庫後可在「探索」中檢索。ClawHub 在搜尋時即時檢索。停用來源僅移除搜尋結果，保留已安裝 Skill。",
            "Synced public GitHub repositories appear in Discover. ClawHub is searched on demand. Disabling removes search results and keeps installed Skills.",
          )}
        </SkillInfo>
      </div>
      {(add.error && !open) || remove.error ? (
        <p role="alert" className="text-sm text-destructive">
          {(add.error ?? remove.error)?.message}
        </p>
      ) : null}
      {sources.error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 p-5 text-sm"
        >
          {sources.error.message}
          <Button variant="link" onClick={() => sources.refetch()}>
            {pick("重试", "重試", "Retry")}
          </Button>
        </div>
      ) : sources.isPending ? (
        <p
          role="status"
          className="py-16 text-center text-sm text-muted-foreground"
        >
          {pick("加载中…", "載入中…", "Loading…")}
        </p>
      ) : (
        <div className="skills-enter divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
          {sources.data?.sources.map((source) => (
            <div
              key={source.sourceId}
              className="flex flex-wrap items-center justify-between gap-4 p-5"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/20">
                  <Github className="size-4 text-muted-foreground" />
                </span>
                <div className="min-w-0">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-sm font-medium hover:underline"
                  >
                    <span className="min-w-0 break-all">{source.label}</span>
                    <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                  </a>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {source.status === "error" ||
                    source.status.startsWith("partial:") ? (
                      <AlertTriangle className="size-3 text-amber-500" />
                    ) : source.status === "active" ? (
                      <CheckCircle2 className="size-3" />
                    ) : null}
                    <span>{status(source.status)}</span>
                    {source.lastRefreshedAt ? (
                      <time
                        dateTime={source.lastRefreshedAt}
                        className="hidden sm:inline"
                      >
                        ·{" "}
                        {new Date(source.lastRefreshedAt).toLocaleString(
                          language,
                        )}
                      </time>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || source.status === "syncing"}
                  onClick={() =>
                    add.mutate(source.sourceId.replace(/^github:/, ""))
                  }
                >
                  <RefreshCw
                    className={
                      source.status === "syncing"
                        ? "motion-safe:animate-spin"
                        : ""
                    }
                  />
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
            <div className="flex flex-col items-center gap-4 py-16">
              <Github className="size-8 text-muted-foreground" />
              <h3 className="text-sm font-medium">
                {pick("尚未添加仓库", "尚未新增倉庫", "No repositories yet")}
              </h3>
              <Button variant="outline" onClick={() => setOpen(true)}>
                <Plus />
                {pick("添加仓库", "新增倉庫", "Add repository")}
              </Button>
            </div>
          ) : null}
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!add.isPending) setOpen(value);
        }}
      >
        <DialogContent
          className="skills-dialog"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById("skill-source-add")?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {pick(
                "添加 GitHub 仓库",
                "新增 GitHub 倉庫",
                "Add GitHub repository",
              )}
            </DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              add.mutate(repo.trim());
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="source-repository">
                {pick("仓库来源", "倉庫來源", "Repository source")}
              </Label>
              <Input
                id="source-repository"
                name="repository"
                required
                autoCapitalize="none"
                spellCheck={false}
                placeholder="owner/repo"
                value={repo}
                onChange={(event) => setRepo(event.target.value)}
              />
            </div>
            {add.error ? (
              <p role="alert" className="text-sm text-destructive">
                {add.error.message}
              </p>
            ) : null}
            <Button variant="brand" disabled={busy} type="submit">
              {add.isPending
                ? pick("同步中…", "同步中…", "Synchronizing…")
                : pick("添加并同步", "新增並同步", "Add & sync")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </SkillWorkspace>
  );
}
