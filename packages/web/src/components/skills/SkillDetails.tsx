"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FileCode2, FolderOpen, Pencil, ExternalLink } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useTrilingual } from "@/hooks/use-trilingual";
import { parseSkillRemoteProvenance, type Skill } from "@/lib/api";
import { normalizeVisibility, visibilityLabelKey } from "@/lib/visibility";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { SkillHistory } from "./SkillHistory";
import { readStoredSkillFiles, skillSource } from "./skill-library";

interface Props {
  skill: Skill;
  onClose: () => void;
  onEdit: () => void;
}

export function SkillDetails({ skill, onClose, onEdit }: Props) {
  const { t } = useLanguage();
  const pick = useTrilingual();
  const [selected, setSelected] = useState("SKILL.md");
  const [fileSearch, setFileSearch] = useState("");
  const editing = useRef(false);
  const resources = useMemo(() => {
    try {
      return { files: readStoredSkillFiles(skill), error: false };
    } catch {
      return {
        files: [{ path: "SKILL.md", content: skill.content ?? "" }],
        error: true,
      };
    }
  }, [skill]);
  const provenance = parseSkillRemoteProvenance(skill);
  const sourceUrl = provenance?.sourceUrl;
  const safeSourceUrl =
    sourceUrl && /^https:\/\//iu.test(sourceUrl) ? sourceUrl : undefined;
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        className="skills-panel w-full gap-0 overflow-y-auto sm:max-w-3xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!editing.current)
            document.getElementById(`skill-open-${skill.id}`)?.focus();
        }}
      >
        <SheetHeader className="gap-3 border-b border-border p-6 pr-12">
          <SheetTitle className="break-words text-xl">{skill.name}</SheetTitle>
          <SheetDescription>
            {skill.description ||
              pick("Skill 详情", "Skill 詳情", "Skill details")}
          </SheetDescription>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              {skillSource(skill) === "local" ? "Local" : skillSource(skill)}
            </span>
            <span>v{skill.version ?? "1.0.0"}</span>
            <span>
              {t(visibilityLabelKey(normalizeVisibility(skill.visibility)))}
            </span>
            <span>
              {resources.files.length} {pick("个文件", "個檔案", "files")}
            </span>
            <span>
              {t(
                skill.resourceManifest
                  ? "skills.resourcePackage"
                  : "skills.markdownOnly",
              )}
            </span>
            {provenance ? (
              <span className="break-all font-mono">
                {provenance.repo}@{provenance.resolvedCommitSha.slice(0, 7)}
              </span>
            ) : null}
          </div>
        </SheetHeader>
        <div className="flex flex-wrap gap-2 border-b border-border/70 px-6 py-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              editing.current = true;
              onEdit();
            }}
          >
            <Pencil />
            {t("skills.editSkill")}
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link href="/projects">
              <FolderOpen />
              {pick("在项目中使用", "在專案中使用", "Use in a project")}
            </Link>
          </Button>
          {safeSourceUrl ? (
            <Button size="sm" variant="ghost" asChild>
              <a href={safeSourceUrl} target="_blank" rel="noreferrer">
                <ExternalLink />
                {pick("查看来源", "檢視來源", "View source")}
              </a>
            </Button>
          ) : null}
        </div>
        <div className="flex flex-col gap-5 p-6">
          {provenance &&
          (provenance.storage !== "database" ||
            provenance.legacyGlobalMirror) ? (
            <p
              role="note"
              className="rounded-md border border-amber-500/30 p-3 text-xs text-amber-600 dark:text-amber-300"
            >
              {t("skills.legacyGlobalCopy")}
            </p>
          ) : null}
          {resources.error ? (
            <p role="alert" className="text-sm text-destructive">
              {pick(
                "配套资源读取失败，仅显示 SKILL.md。请重新同步。",
                "配套資源讀取失敗，僅顯示 SKILL.md。請重新同步。",
                "Resources could not be read. Showing SKILL.md only; sync again.",
              )}
            </p>
          ) : null}
          <div className="grid min-w-0 gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-2">
              <label htmlFor="skill-file-search" className="sr-only">
                {pick("查找文件", "尋找檔案", "Find a file")}
              </label>
              <input
                id="skill-file-search"
                type="search"
                value={fileSearch}
                onChange={(event) => setFileSearch(event.target.value)}
                placeholder={pick("查找文件…", "尋找檔案…", "Find file…")}
                className="h-9 min-w-0 rounded-md border border-input bg-background px-3 text-xs focus-visible:outline-2 focus-visible:outline-ring"
              />
              <nav
                aria-label={pick("资源文件", "資源檔案", "Resource files")}
                className="max-h-40 overflow-auto rounded-md border border-border/70 p-1 sm:max-h-[52dvh]"
              >
                {resources.files
                  .filter((file) =>
                    file.path.toLowerCase().includes(fileSearch.toLowerCase()),
                  )
                  .map((file) => (
                    <button
                      type="button"
                      key={file.path}
                      aria-pressed={selected === file.path}
                      onClick={() => setSelected(file.path)}
                      className="flex w-full items-start gap-2 rounded px-2 py-2 text-left text-xs hover:bg-muted aria-pressed:bg-muted aria-pressed:text-brand"
                    >
                      <FileCode2 className="mt-0.5 size-3.5 shrink-0" />
                      <span className="break-all">{file.path}</span>
                    </button>
                  ))}
              </nav>
            </div>
            <div className="min-w-0 overflow-hidden rounded-md border border-border/70">
              <h3 className="truncate border-b border-border/70 bg-muted/30 px-4 py-2.5 font-mono text-xs">
                {selected}
              </h3>
              <pre
                aria-label={pick("文件内容", "檔案內容", "File content")}
                tabIndex={0}
                className="max-h-[52dvh] min-h-64 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-6 focus-visible:outline-2 focus-visible:outline-ring"
              >
                {resources.files.find((file) => file.path === selected)
                  ?.content || t("skills.previewEmpty")}
              </pre>
            </div>
          </div>
          {provenance ? <SkillHistory skillId={skill.id} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
