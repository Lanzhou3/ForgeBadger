"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Eye, FileText, Globe2, Pencil, Save } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarkdownRenderer } from "@/components/projects/markdown-renderer";
import { highlightWorkspaceCode, tokenFontStyle } from "@/components/projects/workspace/highlight";
import { useLanguage } from "@/hooks/use-language";
import type { AiConfigFile, AiConfigSnapshot } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ProjectConfigPanelProps {
  projectConfig?: AiConfigSnapshot;
  globalConfig?: AiConfigSnapshot;
  selectedPath: string;
  draft: string;
  dirty: boolean;
  savedFlash: boolean;
  projectLoading: boolean;
  globalLoading: boolean;
  isSaving: boolean;
  error: unknown;
  onSelectedPathChange: (path: string) => void;
  onDraftChange: (content: string) => void;
  onSave: () => void;
}

export function ProjectConfigPanel({
  projectConfig,
  globalConfig,
  selectedPath,
  draft,
  dirty,
  savedFlash,
  projectLoading,
  globalLoading,
  isSaving,
  error,
  onSelectedPathChange,
  onDraftChange,
  onSave,
}: ProjectConfigPanelProps) {
  const { t } = useLanguage();
  const projectFiles = projectConfig?.files ?? [];
  const globalFiles = globalConfig?.files ?? [];
  const selectedFile = projectFiles.find((file) => file.relativePath === selectedPath);
  const isMarkdown = selectedFile?.fileType === "markdown";
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setEditing(false);
  }, [selectedPath]);

  if (projectLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t("common.loading")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="size-4 text-brand" />
            {t("projects.projectConfigFiles")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {projectFiles.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t("projects.noConfigFiles")}</div>
          ) : (
            projectFiles.map((file) => (
              <button
                key={file.relativePath}
                type="button"
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                  file.relativePath === selectedPath
                    ? "border-brand/50 bg-brand/10 text-foreground"
                    : "border-border/70 bg-background hover:bg-muted/40",
                )}
                onClick={() => onSelectedPathChange(file.relativePath)}
              >
                <span className="min-w-0 truncate font-mono text-xs">{file.relativePath}</span>
                <Badge variant={file.exists ? "secondary" : "outline"}>
                  {file.exists ? t("projects.configExists") : t("projects.configMissing")}
                </Badge>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
          <div className="flex min-w-0 items-center gap-2">
            <CardTitle className="min-w-0 truncate font-mono text-sm font-semibold">
              {selectedFile?.relativePath ?? t("projects.selectConfigFile")}
            </CardTitle>
            {savedFlash && !dirty && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <Check className="size-3" />
                {t("projects.workspaceFileSaved")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedFile && !editing && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(true)}
                disabled={!selectedFile}
              >
                <Pencil className="size-4" />
                {t("projects.editFile")}
              </Button>
            )}
            {selectedFile && editing && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(false)}
                  disabled={isSaving}
                >
                  <Eye className="size-4" />
                  {t("projects.previewFile")}
                </Button>
                <span className="hidden text-[11px] text-muted-foreground sm:inline">
                  {t("projects.configEditorShortcutHint")}
                </span>
                <Button
                  size="sm"
                  variant="brand"
                  onClick={onSave}
                  disabled={!selectedFile || !dirty || isSaving}
                >
                  <Save className="size-4" />
                  {isSaving ? t("projects.savingConfig") : t("common.save")}
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {selectedFile && !editing ? (
            isMarkdown ? (
              <MarkdownRenderer
                content={draft}
                className="max-h-[560px] min-h-[200px] space-y-3 overflow-y-auto rounded-md border border-border/70 bg-background p-4 text-sm leading-relaxed text-foreground/90"
              />
            ) : (
              <SyntaxHighlightedEditor
                content={draft}
                fileType={selectedFile.fileType ?? "text"}
                relativePath={selectedFile.relativePath}
                disabled
                readOnly
                ariaLabel={selectedFile.relativePath}
              />
            )
          ) : (
            <SyntaxHighlightedEditor
              content={draft}
              fileType={selectedFile?.fileType ?? "text"}
              relativePath={selectedFile?.relativePath}
              disabled={!selectedFile || isSaving}
              ariaLabel={selectedFile?.relativePath ?? t("projects.selectConfigFile")}
              onChange={onDraftChange}
              onSave={() => {
                if (dirty && !isSaving) onSave();
              }}
            />
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {selectedFile && (
              <>
                <Badge variant="outline">{selectedFile.fileType}</Badge>
                <Badge variant="outline">{selectedFile.role}</Badge>
                <span>{selectedFile.sizeBytes} bytes</span>
              </>
            )}
          </div>
          {Boolean(error) && (
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : t("projects.failedSaveConfig")}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:col-span-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Globe2 className="size-4 text-brand" />
              {t("projects.globalConfigReadOnly")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {globalLoading ? (
              <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
            ) : globalFiles.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t("projects.noGlobalConfig")}</div>
            ) : (
              globalFiles.map((file) => (
                <GlobalConfigPreview key={file.relativePath} file={file} />
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SyntaxHighlightedEditor({
  content,
  fileType,
  relativePath,
  disabled,
  ariaLabel,
  onChange,
  onSave,
  readOnly = false,
  minHeightClassName = "min-h-[560px]",
}: {
  content: string;
  fileType: string;
  relativePath?: string;
  disabled: boolean;
  ariaLabel: string;
  onChange?: (content: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
  minHeightClassName?: string;
}) {
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const lines = useMemo(() => content.split("\n"), [content]);
  const lineNumbers = useMemo(
    () => Array.from({ length: Math.max(lines.length, 1) }, (_, index) => index + 1),
    [lines.length],
  );
  const [tokenLines, setTokenLines] =
    useState<Awaited<ReturnType<typeof highlightWorkspaceCode>>>(null);

  useEffect(() => {
    if (!readOnly) {
      setTokenLines(null);
      return;
    }
    let cancelled = false;
    const hintName =
      relativePath || `config.${fileType === "markdown" ? "md" : fileType || "txt"}`;
    void highlightWorkspaceCode(content, hintName).then((result) => {
      if (!cancelled) {
        setTokenLines(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [content, fileType, readOnly, relativePath]);

  return (
    <div className="overflow-hidden rounded-lg border border-input bg-muted/40 shadow-inner shadow-black/20">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/60 px-3 py-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {readOnly ? "Readonly preview" : "Editor"}
        </span>
        <Badge
          variant="outline"
          className="border-border bg-background text-[10px] text-muted-foreground"
        >
          {fileType || "plain"}
        </Badge>
      </div>
      <div className={cn("grid grid-cols-[3.5rem_minmax(0,1fr)]", minHeightClassName)}>
        <div
          ref={gutterRef}
          aria-hidden="true"
          className="overflow-hidden border-r border-border bg-muted/40 px-2 py-4 text-right font-mono text-[11px] leading-6 text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {lineNumbers.map((lineNumber) => (
            <div key={lineNumber}>{lineNumber}</div>
          ))}
        </div>
        <div className="min-w-0">
          {readOnly ? (
            <pre
              onScroll={(event) => {
                if (gutterRef.current) {
                  gutterRef.current.scrollTop = event.currentTarget.scrollTop;
                }
              }}
              className="h-full max-h-[560px] overflow-auto whitespace-pre p-4 font-mono text-[13px] leading-6 text-foreground/95"
            >
              {tokenLines
                ? tokenLines.map((line, lineIdx) => (
                    <div key={lineIdx}>
                      {line.length === 0
                        ? "\u200B"
                        : line.map((token, tokenIdx) => {
                            const styleFlags = tokenFontStyle(token.fontStyle);
                            return (
                              <span
                                key={tokenIdx}
                                style={token.color ? { color: token.color } : undefined}
                                className={cn(
                                  styleFlags.italic && "italic",
                                  styleFlags.bold && "font-semibold",
                                  styleFlags.underline && "underline",
                                )}
                              >
                                {token.content}
                              </span>
                            );
                          })}
                    </div>
                  ))
                : content}
            </pre>
          ) : (
            <textarea
              className="h-full min-h-[520px] w-full resize-none overflow-auto border-0 bg-background/60 p-4 font-mono text-[13px] leading-6 text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60"
              value={content}
              onChange={(event) => onChange?.(event.target.value)}
              onScroll={(event) => {
                if (gutterRef.current) {
                  gutterRef.current.scrollTop = event.currentTarget.scrollTop;
                }
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                  event.preventDefault();
                  onSave?.();
                }
              }}
              spellCheck={false}
              disabled={disabled}
              aria-label={ariaLabel}
              wrap="off"
            />
          )}
        </div>
      </div>
    </div>
  );
}

function GlobalConfigPreview({ file }: { file: AiConfigFile }) {
  const { t } = useLanguage();
  return (
    <details className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="min-w-0 truncate font-mono text-xs">{file.relativePath}</span>
        <Badge variant={file.exists ? "secondary" : "outline"}>
          {file.exists ? t("projects.configExists") : t("projects.configMissing")}
        </Badge>
      </summary>
      {file.content ? (
        <div className="mt-2">
          <SyntaxHighlightedEditor
            content={file.content}
            fileType={file.fileType}
            relativePath={file.relativePath}
            disabled
            readOnly
            ariaLabel={file.relativePath}
            minHeightClassName="min-h-[260px]"
          />
        </div>
      ) : (
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs leading-5 text-muted-foreground">
          {t("projects.noGlobalConfigContent")}
        </pre>
      )}
    </details>
  );
}
