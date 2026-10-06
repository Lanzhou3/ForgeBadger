"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTrilingual } from "@/hooks/use-trilingual";
import { listProjects } from "@/lib/api";
import {
  installSkillPackage,
  previewSkillPackage,
  type PreviewInput,
} from "@/lib/skill-registry-api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  input: PreviewInput;
  onClose: () => void;
}
// Server-side previews expire; installing an expired preview always fails.
const PREVIEW_TTL_MS = 5 * 60 * 1000;

const warnings: Record<string, [string, string, string]> = {
  "legacy-metadata": [
    "历史版本使用旧版元数据；将按原样恢复。",
    "歷史版本使用舊版元資料；將按原樣復原。",
    "Legacy metadata; the stored version will be restored exactly.",
  ],
  "contains-scripts": [
    "包含脚本；仅下载，安装过程不会执行。",
    "包含腳本；僅下載，安裝過程不會執行。",
    "Includes scripts; installation does not execute them.",
  ],
  "requires-hooks": [
    "包含 Hooks，使用前确认目标 CLI 支持。",
    "包含 Hooks，使用前確認目標 CLI 支援。",
    "Contains hooks; verify target CLI support.",
  ],
  "requires-cli-tools": [
    "声明了工具权限，使用前检查工具要求。",
    "宣告了工具權限，使用前檢查工具要求。",
    "Declares tool permissions; review requirements.",
  ],
  "requires-agent-runtime": [
    "需要特定 Agent 运行环境。",
    "需要特定 Agent 執行環境。",
    "Requires an agent runtime.",
  ],
  "standalone-markdown": [
    "仅导入 SKILL.md，不包含配套资源。",
    "僅匯入 SKILL.md，不包含配套資源。",
    "Standalone SKILL.md; no supporting resources.",
  ],
  "nonstandard-name": [
    "上游名称不符合标准，安装目录使用规范化名称。",
    "上游名稱不符合標準，安裝目錄使用規範化名稱。",
    "Nonstandard upstream name; installed directory uses a normalized name.",
  ],
  "upstream-review-notes": [
    "上游版本有审查提示，请检查全部文件。",
    "上游版本有審查提示，請檢查全部檔案。",
    "Upstream review has notes; inspect all files.",
  ],
};
export function SkillPackageReview({ input, onClose }: Props) {
  const pick = useTrilingual();
  const queryClient = useQueryClient();
  const [file, setFile] = useState("SKILL.md");
  const [projectId, setProjectId] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);
  const preview = useQuery({
    queryKey: ["skill-package-preview", input],
    queryFn: () => previewSkillPackage(input),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const previewExpired =
    preview.data !== undefined && now - preview.dataUpdatedAt > PREVIEW_TTL_MS;
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    enabled: !input.skillId,
  });
  const install = useMutation({
    mutationFn: () => installSkillPackage(preview.data!, projectId),
    onSuccess: async () => {
      await Promise.all(
        ["skills", "skill-search", "skill-revisions", "project-skills"].map(
          (key) => queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
  });
  const pkg = preview.data?.package;
  const selected = pkg?.files.find((item) => item.path === file);
  const change = preview.data?.changes.find((item) => item.path === file);
  const fileNames = [
    ...new Set([
      ...(pkg?.files.map((item) => item.path) ?? []),
      ...(preview.data?.changes.map((item) => item.path) ?? []),
    ]),
  ];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !install.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {pick("审阅 Skill 资源包", "審閱 Skill 資源包", "Review Skill package")}
            {pkg ? ` · ${pkg.name}` : ""}
          </DialogTitle>
          <DialogDescription>
            {pick(
              "确认来源与文件后保存。项目生效需通过配置同步。",
              "確認來源與檔案後儲存。專案生效需透過配置同步。",
              "Review the source and files before saving. Project activation uses configuration sync.",
            )}
          </DialogDescription>
        </DialogHeader>
        {preview.isPending ? (
          <p role="status">
            {pick("正在下载并校验完整资源包…", "正在下載並校驗完整資源包…", "Downloading and validating…")}
          </p>
        ) : preview.error ? (
          <div role="alert" className="space-y-3 text-sm text-destructive">
            {preview.error.message}
            <div>
              <Button variant="outline" onClick={() => preview.refetch()}>
                {pick("重试", "重試", "Retry")}
              </Button>
            </div>
          </div>
        ) : pkg && preview.data ? (
          <>
            <div className="space-y-2 text-sm">
              <p>{pkg.description}</p>
              <a
                href={preview.data.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="block break-all text-brand underline"
              >
                {preview.data.canonicalId}
              </a>
              <p className="text-muted-foreground">
                v{pkg.version} · {pkg.files.length} {pick("个文件", "個檔案", "files")} ·{" "}
                {(pkg.sizeBytes / 1024).toFixed(1)} KiB ·{" "}
                {pkg.license ?? pick("未声明许可证", "未宣告授權條款", "License unspecified")}
              </p>
              <p className="break-all font-mono text-xs text-muted-foreground">
                {preview.data.revision} · {pkg.packageHash.slice(0, 23)}…
              </p>
              {pkg.compatibility ? <p>{pkg.compatibility}</p> : null}
              {pkg.warnings.length > 0 ? (
                <ul className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-amber-600 dark:text-amber-300">
                  {pkg.warnings.map((warning) => {
                    const entry =
                      warnings[warning] ??
                      ([warning, warning, warning] as [string, string, string]);
                    return <li key={warning}>{pick(...entry)}</li>;
                  })}
                </ul>
              ) : null}
            </div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
              <div
                className="max-h-60 overflow-auto rounded-md border border-border/70 p-1 sm:max-h-80"
                aria-label={pick("资源文件", "資源檔案", "Package files")}
              >
                {fileNames.map((path) => (
                  <button
                    key={path}
                    onClick={() => setFile(path)}
                    aria-pressed={file === path}
                    className={`block w-full break-all rounded px-2 py-2 text-left font-mono text-xs hover:bg-muted ${file === path ? "bg-muted text-brand" : ""}`}
                  >
                    {path}
                    {input.skillId ? (
                      <span className="block text-muted-foreground">
                        {preview.data?.changes.find((c) => c.path === path)
                          ?.kind ?? pick("未变更", "未變更", "unchanged")}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
              <div className="min-w-0 space-y-2">
                {input.skillId && change?.before !== undefined ? (
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      {pick("变更前", "變更前", "Before change")}
                    </summary>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 p-3 text-xs">
                      {change.before}
                    </pre>
                  </details>
                ) : null}
                <pre
                  aria-label={pick("文件内容", "檔案內容", "File content")}
                  className="max-h-80 min-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-muted/20 p-3 text-xs"
                >
                  {selected?.content ??
                    pick(
                      "此文件将从已保存的资源包中移除。",
                      "此檔案將從已儲存的資源包中移除。",
                      "This file will be removed from the stored package.",
                    )}
                </pre>
              </div>
            </div>
            {!input.skillId && !install.isSuccess ? (
              <label className="space-y-2 text-sm">
                <span>
                  {pick(
                    "选用此 Skill 的项目（可选）",
                    "選用此 Skill 的專案（可選）",
                    "Use in project (optional)",
                  )}
                </span>
                <select
                  aria-label={pick("项目", "專案", "Project")}
                  className="block w-full rounded-md border border-input bg-background p-2"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  <option value="">
                    {pick("仅保存 · 默认禁用", "僅儲存 · 預設停用", "Save only · disabled by default")}
                  </option>
                  {projects.data?.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                {projects.error ? (
                  <span className="text-destructive">
                    {projects.error.message}
                  </span>
                ) : null}
              </label>
            ) : null}
            {install.error ? (
              <div role="alert" className="space-y-2 text-sm text-destructive">
                <p>{install.error.message}</p>
                <Button variant="outline" onClick={() => { install.reset(); setFile("SKILL.md"); void preview.refetch(); }}>
                  {pick("重新获取预览", "重新取得預覽", "Refresh preview")}
                </Button>
              </div>
            ) : null}
            {install.isSuccess ? (
              <div
                role="status"
                className="space-y-3 rounded-md border border-border/70 bg-muted/20 p-3 text-sm"
              >
                <p>
                  {pick(
                    "已保存。请在项目配置中预览并同步，使变更生效。",
                    "已儲存。請在專案配置中預覽並同步，使變更生效。",
                    "Saved. Review and sync project configuration to activate changes.",
                  )}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={onClose}>
                    {pick("关闭", "關閉", "Close")}
                  </Button>
                  <Button asChild>
                    <Link
                      href={projectId ? `/projects/${projectId}` : "/skills"}
                    >
                      {projectId
                        ? pick("打开项目", "開啟專案", "Open project")
                        : pick("查看已安装", "檢視已安裝", "Installed Skills")}
                    </Link>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                {previewExpired ? (
                  <p role="alert" className="text-xs text-amber-600 dark:text-amber-300">
                    {pick("预览已过期，请重新获取后再安装。", "預覽已過期，請重新取得後再安裝。", "Preview expired. Fetch a fresh preview before installing.")}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {pick("预览有效期 5 分钟。", "預覽有效期 5 分鐘。", "Preview expires in 5 minutes.")}
                  </p>
                )}
                {previewExpired ? (
                  <Button variant="outline" onClick={() => { install.reset(); void preview.refetch(); }}>
                    {pick("重新获取预览", "重新取得預覽", "Refresh preview")}
                  </Button>
                ) : null}
                <Button
                  disabled={install.isPending || previewExpired}
                  onClick={() => install.mutate()}
                >
                  {install.isPending
                    ? pick("正在保存…", "正在儲存…", "Saving…")
                    : preview.data.operation === "install"
                      ? pick("已审阅，确认安装", "已審閱，確認安裝", "Reviewed · install")
                      : preview.data.operation === "rollback"
                        ? pick("已审阅，恢复此版本", "已審閱，復原此版本", "Reviewed · restore")
                        : pick("已审阅，确认更新", "已審閱，確認更新", "Reviewed · update")}
                </Button>
              </div>
            )}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
