"use client";

import { useMemo, useRef } from "react";
import {
  Check,
  Circle,
  FileCode2,
  LockKeyhole,
  RotateCcw,
  Save,
} from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useTrilingual } from "@/hooks/use-trilingual";
import type { TemplateFile } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  files: TemplateFile[];
  filePath: string;
  baselinePath: string | null;
  content: string;
  readonly: boolean;
  dirty: boolean;
  loading: boolean;
  error: Error | null;
  saveDisabled: boolean;
  saving: boolean;
  onRetry: () => void;
  onFile: (path: string) => void;
  onPath: (path: string) => void;
  onContent: (content: string) => void;
  onLoad: () => void;
  onSave: () => void;
}

export function TemplateFileEditor(props: Props) {
  const { t } = useLanguage();
  const pick = useTrilingual();
  const gutter = useRef<HTMLPreElement>(null);
  const lineNumbers = useMemo(
    () =>
      Array.from(
        { length: props.content.split("\n").length },
        (_, index) => index + 1,
      ).join("\n"),
    [props.content],
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="template-file-grid min-h-0 flex-1">
        <nav
          aria-label={pick("模板文件", "範本檔案", "Template files")}
          className="min-h-0 overflow-y-auto border-r border-border/70 p-2"
        >
          {props.files.map((file) => (
            <button
              key={file.filePath}
              type="button"
              aria-pressed={file.filePath === props.baselinePath}
              onClick={() => props.onFile(file.filePath)}
              className="flex w-full items-start gap-2 rounded px-2 py-2 text-left text-xs hover:bg-muted/40 aria-pressed:bg-brand/10 aria-pressed:text-brand"
            >
              <FileCode2 className="mt-0.5 size-3.5 shrink-0" />
              <span title={file.filePath} className="min-w-0 truncate">
                {file.filePath}
              </span>
            </button>
          ))}
        </nav>
        <div className="flex min-h-0 min-w-0 flex-col gap-3 p-4">
          <div className="flex shrink-0 items-center gap-2">
            <Label htmlFor="template-file" className="shrink-0 text-xs">
              {t("templates.filePath")}
            </Label>
            <Input
              id="template-file"
              name="filePath"
              className="h-8 min-w-0 font-mono text-xs"
              value={props.filePath}
              onChange={(event) => props.onPath(event.target.value)}
              readOnly={props.readonly}
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={t("templates.loadFile")}
              title={t("templates.loadFile")}
              disabled={props.loading || Boolean(props.error)}
              onClick={props.onLoad}
            >
              <RotateCcw />
            </Button>
          </div>
          {props.error ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 p-4 text-sm text-destructive"
            >
              <span>{props.error.message}</span>
              <Button variant="outline" size="sm" onClick={props.onRetry}>
                {t("common.retry")}
              </Button>
            </div>
          ) : null}
          <div
            className="relative flex min-h-0 flex-1 overflow-hidden rounded-md border border-border/70 bg-background"
            aria-busy={props.loading}
          >
            <pre
              ref={gutter}
              aria-hidden="true"
              className="pointer-events-none w-10 shrink-0 select-none overflow-hidden border-r border-border/70 bg-muted/10 px-2 py-4 text-right font-mono text-xs leading-6 text-muted-foreground"
            >
              {lineNumbers}
            </pre>
            <textarea
              aria-label={t("templates.fileContent")}
              name="content"
              className="min-h-80 min-w-0 flex-1 resize-none bg-transparent p-4 font-mono text-xs leading-6 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              readOnly={props.readonly || props.loading || Boolean(props.error)}
              wrap="off"
              spellCheck={false}
              value={props.content}
              onChange={(event) => props.onContent(event.target.value)}
              onScroll={(event) => {
                if (gutter.current)
                  gutter.current.scrollTop = event.currentTarget.scrollTop;
              }}
            />
          </div>
        </div>
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border/70 pl-5 pr-24 py-3">
        <div
          className="flex items-center gap-2 text-xs text-muted-foreground"
          role="status"
        >
          {props.readonly ? (
            <>
              <LockKeyhole className="size-3.5" />
              {pick("只读", "唯讀", "Read-only")}
              <InfoTip
                label={pick(
                  "内置模板说明",
                  "內建範本說明",
                  "About built-in templates",
                )}
              >
                {t("templates.availableDescription")}
              </InfoTip>
            </>
          ) : props.loading ? (
            t("common.loading")
          ) : props.error ? (
            t("common.loadFailedTitle")
          ) : props.dirty ? (
            <>
              <Circle className="size-2 fill-brand text-brand" />
              {pick("未保存", "未儲存", "Unsaved changes")}
            </>
          ) : (
            <>
              <Check className="size-3.5" />
              {pick("已保存", "已儲存", "Saved")}
            </>
          )}
        </div>
        {!props.readonly ? (
          <Button
            size="sm"
            variant="brand"
            disabled={props.saveDisabled}
            onClick={props.onSave}
          >
            <Save />
            {props.saving ? t("templates.saving") : t("templates.save")}
          </Button>
        ) : null}
      </footer>
    </div>
  );
}
