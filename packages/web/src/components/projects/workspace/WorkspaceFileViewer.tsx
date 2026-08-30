"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileText, X } from "lucide-react";
import type { ThemedToken } from "shiki";

import { Button } from "@/components/ui/button";
import { getProjectWorkspaceFile } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/hooks/use-language";
import { highlightWorkspaceCode, tokenFontStyle } from "./highlight";
import { formatBytes, formatWorkspaceTime } from "./utils";

interface WorkspaceFileViewerProps {
  projectId: string;
  path: string | null;
  enabled?: boolean;
  variant?: "panel" | "sheet";
  onClose?: () => void;
  /** 1-based source line to highlight and scroll to once the file loads. */
  focusLine?: number | null;
  className?: string;
}

export function WorkspaceFileViewer({
  projectId,
  path,
  enabled = true,
  variant = "panel",
  onClose,
  focusLine,
  className,
}: WorkspaceFileViewerProps) {
  const { t } = useLanguage();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  const fileQuery = useQuery({
    queryKey: ["workspace-context", projectId, "file", path],
    queryFn: () => getProjectWorkspaceFile(projectId, path!),
    enabled: enabled && Boolean(path),
    retry: false,
  });
  const file = fileQuery.data;

  // Scroll the focused line into view once content is rendered.
  useEffect(() => {
    if (!focusLine || !file) {
      setHighlightedLine(null);
      return;
    }
    setHighlightedLine(focusLine);
    const timer = setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = Math.max(0, (focusLine - 5) * 20);
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [focusLine, file]);
  const lines = useMemo(() => file?.content.split("\n") ?? [], [file?.content]);
  const highlightedTokens = useWorkspaceHighlight(
    file && !file.binary && file.content.length > 0 ? file.name : null,
    file?.content ?? null
  );

  return (
    <div
      data-testid="workspace-file-viewer"
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-md border border-border/70 bg-background/70",
        className
      )}
    >
      {path ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
          <nav aria-label={t("projects.workspaceBreadcrumb")} className="min-w-0">
            <ol className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-xs">
              {path.split("/").map((segment, index, segments) => {
                const isLast = index === segments.length - 1;
                return (
                  <li key={`${index}-${segment}`} className="flex min-w-0 items-center gap-1">
                    {index > 0 ? <span className="text-muted-foreground/50">/</span> : null}
                    <span
                      className={cn(
                        "truncate",
                        isLast ? "font-medium text-foreground" : "text-muted-foreground"
                      )}
                    >
                      {segment}
                    </span>
                  </li>
                );
              })}
            </ol>
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            {file ? (
              <span className="text-[11px] text-muted-foreground">
                {formatBytes(file.sizeBytes)} · {formatWorkspaceTime(file.updatedAt)}
              </span>
            ) : null}
            {variant === "sheet" && onClose ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={onClose}
                aria-label={t("projects.workspaceCloseViewer")}
                title={t("projects.workspaceCloseViewer")}
              >
                <X className="size-4" />
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {file?.truncated && !file.binary ? (
        <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-400">
          <AlertTriangle className="size-3.5 shrink-0" />
          {t("projects.workspaceFileTruncated")}
        </div>
      ) : null}

      {!path ? (
        <div className="flex min-h-[240px] flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <div className="flex size-10 items-center justify-center rounded-md bg-brand/10 text-brand">
            <FileText className="size-5" />
          </div>
          <p className="text-xs text-muted-foreground">{t("projects.workspaceSelectFile")}</p>
        </div>
      ) : fileQuery.isLoading ? (
        <div className="min-h-[240px] flex-1 space-y-2 p-4" aria-hidden="true">
          {[100, 88, 94, 70, 82, 60, 90, 48].map((width, index) => (
            <div
              key={index}
              className="h-3.5 animate-pulse rounded bg-muted/50"
              style={{ width: `${width}%` }}
            />
          ))}
        </div>
      ) : fileQuery.isError ? (
        <ViewerNotice
          destructive
          message={
            fileQuery.error instanceof Error
              ? fileQuery.error.message
              : t("projects.workspaceFileLoadFailed")
          }
        />
      ) : file?.binary ? (
        <ViewerNotice message={t("projects.workspaceBinaryFile")} />
      ) : !file || file.content.length === 0 ? (
        <ViewerNotice message={t("projects.workspaceFileEmpty")} />
      ) : (
        <div
          ref={scrollRef}
          className="min-h-[240px] min-w-0 flex-1 overflow-auto [scrollbar-width:thin]"
        >
          <div className="flex min-w-max items-stretch">
            <div
              aria-label={t("projects.workspaceLineNumbers")}
              className="sticky left-0 shrink-0 select-none border-r border-border/70 bg-muted/40 px-2 py-3 text-right font-mono text-xs leading-5 text-muted-foreground/60"
            >
              {lines.map((_, index) => (
                <div
                  key={index}
                  className={cn(
                    index + 1 === highlightedLine && "bg-brand/15 text-brand"
                  )}
                >
                  {index + 1}
                </div>
              ))}
            </div>
            <div className="flex-1 px-3 py-3 font-mono text-xs leading-5 text-foreground">
              {lines.map((line, index) => {
                const tokens = highlightedTokens?.[index];
                return (
                  <div
                    key={index}
                    className={cn(
                      "whitespace-pre",
                      index + 1 === highlightedLine &&
                        "-mx-3 rounded-sm bg-brand/10 px-3 ring-1 ring-brand/40"
                    )}
                  >
                    {tokens ? <TokenLine tokens={tokens} /> : line.length > 0 ? line : " "}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TokenLine({ tokens }: { tokens: ThemedToken[] }) {
  return (
    <>
      {tokens.map((token, index) => {
        const style = tokenFontStyle(token.fontStyle);
        return (
          <span
            key={index}
            style={{
              color: token.color,
              fontStyle: style.italic ? "italic" : undefined,
              fontWeight: style.bold ? 600 : undefined,
              textDecoration: style.underline ? "underline" : undefined,
            }}
          >
            {token.content}
          </span>
        );
      })}
    </>
  );
}

/**
 * Tokenizes the loaded file with Shiki. Returns null while the grammar is
 * loading or when the file type has no grammar — the viewer renders plain
 * text in both cases, so there is no layout shift when colors arrive.
 */
function useWorkspaceHighlight(
  fileName: string | null,
  content: string | null
): ThemedToken[][] | null {
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTokens(null);
    if (!fileName || !content) return;
    void highlightWorkspaceCode(content, fileName).then((result) => {
      if (!cancelled) setTokens(result);
    });
    return () => {
      cancelled = true;
    };
  }, [fileName, content]);

  return tokens;
}

function ViewerNotice({  message,
  destructive = false,
}: {
  message: string;
  destructive?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[240px] flex-1 items-center justify-center gap-2 px-4 py-10 text-center text-xs text-muted-foreground",
        destructive && "text-destructive"
      )}
    >
      {destructive ? <AlertTriangle className="size-4" /> : null}
      <span>{message}</span>
    </div>
  );
}
