"use client";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "@/hooks/use-language";
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
const warnings: Record<string, [string, string]> = {
  "legacy-metadata": [
    "历史版本使用旧版元数据；将按原样恢复。",
    "Legacy metadata; the stored version will be restored exactly.",
  ],
  "contains-scripts": [
    "包含脚本；仅下载，安装过程不会执行。",
    "Includes scripts; installation does not execute them.",
  ],
  "requires-hooks": [
    "包含 Hooks，使用前确认目标 CLI 支持。",
    "Contains hooks; verify target CLI support.",
  ],
  "requires-cli-tools": [
    "声明了工具权限，使用前检查工具要求。",
    "Declares tool permissions; review requirements.",
  ],
  "requires-agent-runtime": [
    "需要特定 Agent 运行环境。",
    "Requires an agent runtime.",
  ],
  "standalone-markdown": [
    "仅导入 SKILL.md，不包含配套资源。",
    "Standalone SKILL.md; no supporting resources.",
  ],
  "nonstandard-name": [
    "上游名称不符合标准，安装目录使用规范化名称。",
    "Nonstandard upstream name; installed directory uses a normalized name.",
  ],
  "upstream-review-notes": [
    "上游版本有审查提示，请检查全部文件。",
    "Upstream review has notes; inspect all files.",
  ],
};
export function SkillPackageReview({ input, onClose }: Props) {
  const { language } = useLanguage();
  const en = language === "en";
  const queryClient = useQueryClient();
  const [file, setFile] = useState("SKILL.md");
  const [projectId, setProjectId] = useState("");
  const preview = useQuery({
    queryKey: ["skill-package-preview", input],
    queryFn: () => previewSkillPackage(input),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
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
            {en ? "Review Skill package" : "审阅 Skill 资源包"}
            {pkg ? ` · ${pkg.name}` : ""}
          </DialogTitle>
          <DialogDescription>
            {en
              ? "Review the source and files before saving. Project activation uses configuration sync."
              : "确认来源与文件后保存。项目生效需通过配置同步。"}
          </DialogDescription>
        </DialogHeader>
        {preview.isPending ? (
          <p role="status">
            {en ? "Downloading and validating…" : "正在下载并校验完整资源包…"}
          </p>
        ) : preview.error ? (
          <div role="alert" className="space-y-3 text-sm text-destructive">
            {preview.error.message}
            <div>
              <Button variant="outline" onClick={() => preview.refetch()}>
                {en ? "Retry" : "重试"}
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
                v{pkg.version} · {pkg.files.length} {en ? "files" : "个文件"} ·{" "}
                {(pkg.sizeBytes / 1024).toFixed(1)} KiB ·{" "}
                {pkg.license ?? (en ? "License unspecified" : "未声明许可证")}
              </p>
              <p className="break-all font-mono text-xs text-muted-foreground">
                {preview.data.revision} · {pkg.packageHash.slice(0, 23)}…
              </p>
              {pkg.compatibility ? <p>{pkg.compatibility}</p> : null}
              {pkg.warnings.length > 0 ? (
                <ul className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-amber-600 dark:text-amber-300">
                  {pkg.warnings.map((warning) => (
                    <li key={warning}>
                      {warnings[warning]?.[en ? 1 : 0] ?? warning}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
              <div
                className="max-h-60 overflow-auto rounded-md border border-border/70 p-1 sm:max-h-80"
                aria-label={en ? "Package files" : "资源文件"}
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
                          ?.kind ?? (en ? "unchanged" : "未变更")}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
              <div className="min-w-0 space-y-2">
                {input.skillId && change?.before !== undefined ? (
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      {en ? "Before change" : "变更前"}
                    </summary>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 p-3 text-xs">
                      {change.before}
                    </pre>
                  </details>
                ) : null}
                <pre
                  aria-label={en ? "File content" : "文件内容"}
                  className="max-h-80 min-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-muted/20 p-3 text-xs"
                >
                  {selected?.content ??
                    (en
                      ? "This file will be removed from the stored package."
                      : "此文件将从已保存的资源包中移除。")}
                </pre>
              </div>
            </div>
            {!input.skillId && !install.isSuccess ? (
              <label className="space-y-2 text-sm">
                <span>
                  {en
                    ? "Use in project (optional)"
                    : "选用此 Skill 的项目（可选）"}
                </span>
                <select
                  aria-label={en ? "Project" : "项目"}
                  className="block w-full rounded-md border border-input bg-background p-2"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  <option value="">
                    {en
                      ? "Save only · disabled by default"
                      : "仅保存 · 默认禁用"}
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
                  {en ? "Refresh preview" : "重新获取预览"}
                </Button>
              </div>
            ) : null}
            {install.isSuccess ? (
              <div
                role="status"
                className="space-y-3 rounded-md border border-border/70 bg-muted/20 p-3 text-sm"
              >
                <p>
                  {en
                    ? "Saved. Review and sync project configuration to activate changes."
                    : "已保存。请在项目配置中预览并同步，使变更生效。"}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={onClose}>
                    {en ? "Close" : "关闭"}
                  </Button>
                  <Button asChild>
                    <Link
                      href={projectId ? `/projects/${projectId}` : "/skills"}
                    >
                      {projectId
                        ? en
                          ? "Open project"
                          : "打开项目"
                        : en
                          ? "Installed Skills"
                          : "查看已安装"}
                    </Link>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {en ? "Preview expires in 5 minutes." : "预览有效期 5 分钟。"}
                </p>
                <Button
                  disabled={install.isPending}
                  onClick={() => install.mutate()}
                >
                  {install.isPending
                    ? en
                      ? "Saving…"
                      : "正在保存…"
                    : preview.data.operation === "install"
                      ? en
                        ? "Reviewed · install"
                        : "已审阅，确认安装"
                      : preview.data.operation === "rollback"
                        ? en
                          ? "Reviewed · restore"
                          : "已审阅，恢复此版本"
                        : en
                          ? "Reviewed · update"
                          : "已审阅，确认更新"}
                </Button>
              </div>
            )}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
