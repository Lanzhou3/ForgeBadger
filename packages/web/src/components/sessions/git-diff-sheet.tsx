"use client";

import { useQuery } from "@tanstack/react-query";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useLanguage } from "@/hooks/use-language";
import { getProjectGitFileDiff, type ProjectGitFileDiff } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface GitDiffTarget {
  path: string;
  untracked: boolean;
}

interface Props {
  projectId: string;
  target: GitDiffTarget | null;
  onClose: () => void;
}

export function GitDiffSheet({ projectId, target, onClose }: Props) {
  const { t } = useLanguage();
  const { data, error, isLoading } = useQuery({
    queryKey: ["project-git-diff", projectId, target?.path, target?.untracked],
    queryFn: () =>
      getProjectGitFileDiff(projectId, target?.path ?? "", { untracked: target?.untracked }),
    enabled: Boolean(target),
    retry: false,
  });

  return (
    <Sheet
      open={Boolean(target)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="truncate font-mono text-sm">{target?.path}</SheetTitle>
          <SheetDescription>
            {target?.untracked ? t("sessions.gitDiffUntracked") : t("sessions.gitDiffTitle")}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-[#05070a] p-2">
          {isLoading ? (
            <p className="p-2 text-xs text-muted-foreground">{t("sessions.gitDiffLoading")}</p>
          ) : error ? (
            <p className="p-2 text-xs text-destructive">{t("sessions.gitLoadFailed")}</p>
          ) : data ? (
            <DiffContent file={data} emptyLabel={t("sessions.gitDiffEmpty")} />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DiffContent({ file, emptyLabel }: { file: ProjectGitFileDiff; emptyLabel: string }) {
  if (file.kind === "untracked") {
    return (
      <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-5 text-emerald-300/90">
        {file.content ?? ""}
      </pre>
    );
  }
  const lines = (file.diff ?? "").split("\n");
  if (lines.every((line) => line.trim().length === 0)) {
    return <p className="p-2 text-xs text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <pre className="font-mono text-xs leading-5">
      {lines.map((line, index) => (
        <div key={index} className={cn("whitespace-pre-wrap break-all px-1", diffLineClassName(line))}>
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

function diffLineClassName(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "text-muted-foreground";
  if (line.startsWith("+")) return "bg-emerald-500/10 text-emerald-300";
  if (line.startsWith("-")) return "bg-red-500/10 text-red-300";
  if (line.startsWith("@@")) return "text-sky-400";
  if (line.startsWith("diff --git") || line.startsWith("index ")) return "text-muted-foreground";
  return "text-foreground/80";
}
