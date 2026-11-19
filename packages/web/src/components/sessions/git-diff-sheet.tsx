"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useLanguage } from "@/hooks/use-language";
import { getProjectGitFileDiff, type ProjectGitFileDiff } from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export interface GitDiffTarget {
  path: string;
  untracked: boolean;
  staged?: boolean;
}

interface Props {
  projectId: string;
  target: GitDiffTarget | null;
  onClose: () => void;
  onOpenInFiles?: (path: string) => void;
  onToggleStage?: (target: GitDiffTarget) => void;
  onDiscard?: (target: GitDiffTarget) => void;
  actionBusy?: boolean;
}

export function GitDiffSheet({
  projectId,
  target,
  onClose,
  onOpenInFiles,
  onToggleStage,
  onDiscard,
  actionBusy = false,
}: Props) {
  const { t } = useLanguage();
  const [copiedPath, setCopiedPath] = useState(false);
  const [copiedDiff, setCopiedDiff] = useState(false);

  const { data, error, isLoading } = useQuery({
    queryKey: ["project-git-diff", projectId, target?.path, target?.untracked],
    queryFn: () =>
      getProjectGitFileDiff(projectId, target?.path ?? "", { untracked: target?.untracked }),
    enabled: Boolean(target),
    retry: false,
  });

  async function handleCopyPath() {
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target.path);
      setCopiedPath(true);
      toast.success(t("projects.pathCopied"));
      setTimeout(() => setCopiedPath(false), 1600);
    } catch {
      // Clipboard unavailable.
    }
  }

  async function handleCopyDiff() {
    if (!data) return;
    const text = data.kind === "untracked" ? (data.content ?? "") : (data.diff ?? "");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedDiff(true);
      toast.success(t("projects.gitDiffCopied"));
      setTimeout(() => setCopiedDiff(false), 1600);
    } catch {
      // Clipboard unavailable.
    }
  }

  return (
    <Sheet
      open={Boolean(target)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-3xl">
        <SheetHeader className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
            <SheetTitle className="truncate font-mono text-sm">{target?.path}</SheetTitle>
            {target && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => void handleCopyPath()}
                >
                  {copiedPath ? <Check className="size-3" /> : <Copy className="size-3" />}
                  {t("projects.copyPath")}
                </Button>
                {data && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => void handleCopyDiff()}
                  >
                    {copiedDiff ? <Check className="size-3" /> : <Copy className="size-3" />}
                    {t("projects.gitCopyDiff")}
                  </Button>
                )}
                {onOpenInFiles && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      const filePath = target.path;
                      onClose();
                      onOpenInFiles(filePath);
                    }}
                  >
                    <ExternalLink className="size-3" />
                    {t("projects.overviewOpenInFiles")}
                  </Button>
                )}
                {onToggleStage && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 px-2 text-xs"
                    disabled={actionBusy}
                    onClick={() => onToggleStage(target)}
                  >
                    {target.staged ? t("projects.gitUnstageFile") : t("projects.gitStageFile")}
                  </Button>
                )}
                {onDiscard && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                    disabled={actionBusy}
                    onClick={() => onDiscard(target)}
                  >
                    <RotateCcw className="size-3" />
                    {t("projects.gitDiscardFile")}
                  </Button>
                )}
              </div>
            )}
          </div>
          <SheetDescription>
            {target?.untracked ? t("sessions.gitDiffUntracked") : t("sessions.gitDiffTitle")}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-terminal">
          {isLoading ? (
            <p className="p-3 text-xs text-muted-foreground">{t("sessions.gitDiffLoading")}</p>
          ) : error ? (
            <p className="p-3 text-xs text-destructive">{t("sessions.gitLoadFailed")}</p>
          ) : data ? (
            <DiffContent file={data} emptyLabel={t("sessions.gitDiffEmpty")} />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface ParsedDiffRow {
  kind: "meta" | "hunk" | "add" | "del" | "context";
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function parseUnifiedDiff(diffText: string): ParsedDiffRow[] {
  const rawLines = diffText.split("\n");
  let oldNum = 1;
  let newNum = 1;
  let insideHunk = false;
  return rawLines.map((line): ParsedDiffRow => {
    const hunkMatch = HUNK_HEADER_RE.exec(line);
    if (hunkMatch) {
      oldNum = Number(hunkMatch[1]);
      newNum = Number(hunkMatch[2]);
      insideHunk = true;
      return { kind: "hunk", text: line, oldLine: null, newLine: null };
    }
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("\\ No newline")
    ) {
      return { kind: "meta", text: line, oldLine: null, newLine: null };
    }
    if (line.startsWith("+")) {
      const n = insideHunk ? newNum : null;
      newNum += 1;
      return { kind: "add", text: line, oldLine: null, newLine: n };
    }
    if (line.startsWith("-")) {
      const o = insideHunk ? oldNum : null;
      oldNum += 1;
      return { kind: "del", text: line, oldLine: o, newLine: null };
    }
    const o = insideHunk ? oldNum : null;
    const n = insideHunk ? newNum : null;
    if (insideHunk) {
      oldNum += 1;
      newNum += 1;
    }
    return { kind: "context", text: line, oldLine: o, newLine: n };
  });
}

function DiffContent({ file, emptyLabel }: { file: ProjectGitFileDiff; emptyLabel: string }) {
  if (file.kind === "untracked") {
    const lines = (file.content ?? "").split("\n");
    return (
      <div className="py-1.5 font-mono text-xs leading-5">
        {lines.map((line, index) => (
          <div key={index} className="grid grid-cols-[3rem_minmax(0,1fr)] bg-success/8 hover:bg-success/14">
            <span
              aria-hidden="true"
              className="forgebadger-tabular-nums border-r border-border/50 px-2 text-right text-[11px] text-muted-foreground/55 select-none"
            >
              {index + 1}
            </span>
            <span className="whitespace-pre-wrap break-all px-2.5 text-success">{line || " "}</span>
          </div>
        ))}
      </div>
    );
  }
  const raw = file.diff ?? "";
  if (raw.split("\n").every((line) => line.trim().length === 0)) {
    return <p className="p-3 text-xs text-muted-foreground">{emptyLabel}</p>;
  }
  const rows = parseUnifiedDiff(raw);
  return (
    <div className="py-1 font-mono text-xs leading-5">
      {rows.map((row, index) => {
        if (row.kind === "hunk") {
          return (
            <div
              key={index}
              className="my-0.5 border-y border-hue-sky/20 bg-hue-sky/10 px-3 py-0.5 text-[11px] text-hue-sky"
            >
              {row.text}
            </div>
          );
        }
        if (row.kind === "meta") {
          return (
            <div key={index} className="px-3 py-0.5 text-[11px] text-muted-foreground/75">
              {row.text}
            </div>
          );
        }
        return (
          <div
            key={index}
            className={cn(
              "grid grid-cols-[2.75rem_2.75rem_minmax(0,1fr)]",
              row.kind === "add"
                ? "bg-success/10 hover:bg-success/16"
                : row.kind === "del"
                  ? "bg-destructive/10 hover:bg-destructive/16"
                  : "hover:bg-muted/30"
            )}
          >
            <span
              aria-hidden="true"
              className="forgebadger-tabular-nums px-1.5 text-right text-[10px] text-muted-foreground/50 select-none"
            >
              {row.oldLine ?? ""}
            </span>
            <span
              aria-hidden="true"
              className="forgebadger-tabular-nums border-r border-border/50 px-1.5 text-right text-[10px] text-muted-foreground/50 select-none"
            >
              {row.newLine ?? ""}
            </span>
            <span
              className={cn(
                "whitespace-pre-wrap break-all px-2.5",
                row.kind === "add"
                  ? "text-success"
                  : row.kind === "del"
                    ? "text-destructive"
                    : "text-foreground/85"
              )}
            >
              {row.text || " "}
            </span>
          </div>
        );
      })}
    </div>
  );
}
