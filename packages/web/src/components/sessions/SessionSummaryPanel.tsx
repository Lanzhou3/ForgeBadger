"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ChevronRight } from "lucide-react";

import { useLanguage } from "@/hooks/use-language";
import { useTrilingual } from "@/hooks/use-trilingual";
import { localeForLanguage } from "@/lib/i18n";
import { getSessionSummary } from "@/lib/session-summary-api";
import { cn } from "@/lib/utils";

interface Props {
  sessionId: string;
}

export function SessionSummaryPanel({ sessionId }: Props) {
  const { language } = useLanguage();
  const pick = useTrilingual();
  const locale = localeForLanguage(language);
  const query = useQuery({
    queryKey: ["session-summary", sessionId],
    queryFn: () => getSessionSummary(sessionId),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && detailsRef.current?.open) {
        detailsRef.current.open = false;
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (detailsRef.current?.open && target instanceof Node && !detailsRef.current.contains(target)) {
        detailsRef.current.open = false;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  const current = query.data?.summary;
  const result = query.data?.latestResult;
  const state = query.data?.workState;
  const stateLabel =
    state === "working"
      ? pick("执行中", "執行中", "Working")
      : state === "idle"
        ? pick("空闲", "空閒", "Idle")
        : state
          ? pick("当前进度未知", "目前進度未知", "Current progress unknown")
          : null;
  const collapsedHint = current?.request ?? result?.error?.text ?? result?.result?.text ?? null;

  return (
    <details
      ref={detailsRef}
      className="group relative z-30 shrink-0 border-b border-border/70 bg-card/45 text-xs"
      data-testid="session-summary"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-muted-foreground transition-colors select-none hover:bg-muted/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            state === "working"
              ? "bg-brand motion-safe:animate-pulse"
              : state === "idle"
                ? "bg-success"
                : "bg-muted-foreground/45"
          )}
        />
        <Activity className="size-3.5 shrink-0 text-muted-foreground/80" aria-hidden="true" />
        <span className="shrink-0 font-medium text-foreground/85">
          {pick("会话最新进度", "會話最新進度", "Latest session progress")}
          {stateLabel ? (
            <span className={cn("font-normal", state === "working" ? "text-brand" : "text-muted-foreground")}>
              {` · ${stateLabel}`}
            </span>
          ) : null}
        </span>
        {collapsedHint ? (
          <span
            aria-hidden="true"
            className="hidden min-w-0 flex-1 truncate text-muted-foreground/70 group-open:hidden sm:inline"
          >
            — {collapsedHint}
          </span>
        ) : (
          <span className="flex-1" aria-hidden="true" />
        )}
        <ChevronRight
          aria-hidden="true"
          className="ml-auto size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 group-open:rotate-90"
        />
      </summary>
      <div className="absolute inset-x-0 top-full z-30 max-h-64 space-y-2 overflow-y-auto border-t border-b border-border/70 bg-popover/95 px-3 py-2.5 text-xs leading-relaxed shadow-lg backdrop-blur-md">
        {query.isPending && (
          <p role="status" className="text-muted-foreground">
            {pick("正在读取…", "正在讀取…", "Loading…")}
          </p>
        )}
        {query.isError && (
          <p role="alert" className="text-destructive">
            {pick("无法读取会话摘要。", "無法讀取會話摘要。", "Could not load the session summary.")}
          </p>
        )}
        {query.data && !current && !result && (
          <p className="text-muted-foreground">
            {pick(
              "尚未采集到观察记录，CLI 需重新启动以加载更新后的 hooks。",
              "尚未採集到觀察記錄，CLI 需重新啟動以載入更新後的 hooks。",
              "No observations captured. Restart the CLI to load updated hooks."
            )}
          </p>
        )}
        {current && (
          <div className="space-y-1.5 rounded-md border border-border/70 bg-card/80 p-2.5">
            {current.request && (
              <p className="break-words font-medium text-foreground">
                {pick("当前请求：", "目前請求：", "Current request: ")}
                {current.request}
              </p>
            )}
            {current.progress.map((p, i) => (
              <p key={`${i}:${p.text}`} className="break-words text-muted-foreground">
                {p.text}
              </p>
            ))}
            <p className="forgebadger-tabular-nums text-[11px] text-muted-foreground/75">
              {pick("最后观察：", "最後觀察：", "Last observation: ")}
              {new Date(current.observedAt).toLocaleString(locale)}
            </p>
          </div>
        )}
        {result && (
          <div className="space-y-1.5 rounded-md border border-border/70 bg-card/80 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="forgebadger-tabular-nums">
                {pick("最近记录的轮次", "最近記錄的輪次", "Latest recorded round")} ·{" "}
                {new Date(result.observedAt).toLocaleString(locale)}
              </span>
              {result.result && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">
                  {pick("来源：CLI 最终回复", "來源：CLI 最終回覆", "Source: CLI final reply")}
                </span>
              )}
              {result.error && (
                <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive">
                  {pick("来源：CLI 错误事件", "來源：CLI 錯誤事件", "Source: CLI error event")}
                </span>
              )}
            </div>
            <p
              className={cn(
                "whitespace-pre-wrap break-words",
                result.error ? "text-destructive" : "text-foreground"
              )}
            >
              {result.error?.text ??
                result.result?.text ??
                pick("未采集到本轮结果。", "未採集到本輪結果。", "Round result not captured.")}
            </p>
            {result.identityQuality !== "exact_turn" && (
              <p className="text-[11px] text-muted-foreground">
                {pick(
                  "轮次未确认，仅展示本次事件摘录。",
                  "輪次未確認，僅展示本次事件摘錄。",
                  "Round identity unconfirmed; event excerpt only."
                )}
              </p>
            )}
            {result.verification.length ? (
              <div className="space-y-1 border-t border-border/60 pt-1.5">
                {result.verification.map((v, i) => (
                  <p key={`${i}:${v.text}`} className="break-words font-mono text-[11px] text-muted-foreground">
                    {v.text}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground/75">
                {pick(
                  "未采集到命令验证证据。",
                  "未採集到命令驗證證據。",
                  "No command verification evidence captured."
                )}
              </p>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
