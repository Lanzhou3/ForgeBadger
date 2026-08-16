"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { Bot, Send, X } from "lucide-react";

import { PortfolioCompanionWidget } from "@/components/portfolio/portfolio-companion-widget";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/hooks/use-language";
import { usePortfolioRequestSubmission } from "@/hooks/use-portfolio";
import { GatewayApiError } from "@/lib/api";
import {
  portfolioCompanionChatPosition,
  type PortfolioCompanionAnchor,
} from "@/lib/portfolio-companion";
import { portfolioStatusLabel, usePortfolioCompanionCopy, usePortfolioCopy } from "@/lib/portfolio-i18n";
import type { CreatePortfolioRequestInput, PortfolioRequest } from "@/lib/portfolio-api";

interface PortfolioCompanionPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CompanionMessage {
  id: string;
  role: "copilot" | "user";
  kind: "welcome" | "pending" | "request" | "error";
  text?: string;
  request?: PortfolioRequest;
  input?: CreatePortfolioRequestInput;
  error?: unknown;
}

/** A compact, chat-shaped Portfolio entry point; it never invokes a terminal, model, or provider. */
export function PortfolioCompanionPanel({ open, onOpenChange }: PortfolioCompanionPanelProps) {
  const { t } = useLanguage();
  const { copy } = usePortfolioCopy();
  const { copy: chatCopy } = usePortfolioCompanionCopy();
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [anchor, setAnchor] = useState<PortfolioCompanionAnchor | null>(null);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<CompanionMessage[]>([]);
  const submission = usePortfolioRequestSubmission();

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (panelRef.current?.contains(target) || target.closest("[data-portfolio-companion-widget]")) return;
      onOpenChange(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
    };
  }, [onOpenChange, open]);

  function submit() {
    const originalText = draft.trim();
    if (!originalText || submission.isPending) return;
    const input = { originalText };
    const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setDraft("");
    setMessages((current) => [
      ...current,
      { id: `user-${pendingId}`, role: "user", kind: "welcome", text: originalText },
      { id: pendingId, role: "copilot", kind: "pending" },
    ]);
    submission.submit(input, {
      onSuccess: (request) => replaceMessage(pendingId, { id: pendingId, role: "copilot", kind: "request", request }),
      onError: (error) => replaceMessage(pendingId, { id: pendingId, role: "copilot", kind: "error", input, error }),
    });
  }

  function retry(input: CreatePortfolioRequestInput, failedMessageId: string) {
    replaceMessage(failedMessageId, { id: failedMessageId, role: "copilot", kind: "pending" });
    submission.retry(input, {
      onSuccess: (request) => replaceMessage(failedMessageId, { id: failedMessageId, role: "copilot", kind: "request", request }),
      onError: (error) => replaceMessage(failedMessageId, { id: failedMessageId, role: "copilot", kind: "error", input, error }),
    });
  }

  function replaceMessage(id: string, next: CompanionMessage) {
    setMessages((current) => current.map((message) => message.id === id ? next : message));
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  const position = anchor ? portfolioCompanionChatPosition(anchor.position, anchor.viewport) : null;
  return (
    <>
      <PortfolioCompanionWidget
        onActivate={() => onOpenChange(true)}
        expanded={open}
        controlsId={panelId}
        onPositionChange={setAnchor}
      />
      {open ? (
        <section
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-label={copy.companionTitle}
          className="fixed z-50 flex h-[min(27rem,calc(100dvh-1.5rem))] w-[min(23rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl shadow-black/30"
          style={position ? { left: position.left, top: position.top } : { right: 96, bottom: 96 }}
        >
          <header className="flex items-center gap-2 border-b border-border/70 px-3 py-2.5">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
              <Bot className="size-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">{copy.companionTitle}</h2>
              <p className="truncate text-xs text-muted-foreground">{chatCopy.context}</p>
            </div>
            <Button type="button" variant="ghost" size="icon-xs" aria-label={t("common.close")} title={t("common.close")} onClick={() => onOpenChange(false)}>
              <X className="size-4" aria-hidden="true" />
            </Button>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
            <MessageBubble role="copilot"><p>{chatCopy.welcome}</p></MessageBubble>
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                copy={copy}
                chatCopy={chatCopy}
                onRetry={retry}
              />
            ))}
          </div>

          <div className="border-t border-border/70 bg-muted/10 p-3">
            <Textarea
              ref={inputRef}
              aria-label={chatCopy.placeholder}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onInputKeyDown}
              maxLength={32_768}
              rows={2}
              disabled={submission.isPending}
              placeholder={chatCopy.placeholder}
              className="min-h-16 resize-none border-border/70 bg-background text-sm"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <Link href="/portfolio" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                {chatCopy.openWorkspace}
              </Link>
              <Button type="button" size="sm" className="gap-1.5" disabled={!draft.trim() || submission.isPending} onClick={submit}>
                <Send className="size-3.5" aria-hidden="true" />
                {submission.isPending ? chatCopy.sending : chatCopy.send}
              </Button>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}

function ChatMessage({
  message,
  copy,
  chatCopy,
  onRetry,
}: {
  message: CompanionMessage;
  copy: ReturnType<typeof usePortfolioCopy>["copy"];
  chatCopy: ReturnType<typeof usePortfolioCompanionCopy>["copy"];
  onRetry: (input: CreatePortfolioRequestInput, failedMessageId: string) => void;
}) {
  if (message.role === "user") return <MessageBubble role="user"><p className="whitespace-pre-wrap break-words">{message.text}</p></MessageBubble>;
  if (message.kind === "pending") return <MessageBubble role="copilot"><p className="text-muted-foreground">{chatCopy.sending}</p></MessageBubble>;
  if (message.kind === "request" && message.request) {
    return (
      <MessageBubble role="copilot">
        <p>{chatCopy.saved}</p>
        <p className="mt-1 text-xs text-muted-foreground">{chatCopy.status}: {portfolioStatusLabel(message.request.status, copy)}</p>
      </MessageBubble>
    );
  }
  if (message.kind === "error" && message.input) {
    return (
      <MessageBubble role="copilot" tone="error">
        <p role="alert">{companionError(message.error, chatCopy)}</p>
        <Button type="button" size="xs" variant="outline" className="mt-2" onClick={() => onRetry(message.input as CreatePortfolioRequestInput, message.id)}>
          {chatCopy.retry}
        </Button>
      </MessageBubble>
    );
  }
  return null;
}

function MessageBubble({ children, role, tone = "default" }: { children: ReactNode; role: "copilot" | "user"; tone?: "default" | "error" }) {
  const placement = role === "user" ? "ml-8 bg-brand text-brand-foreground" : "mr-8 bg-muted/50 text-foreground";
  const emphasis = tone === "error" ? "border border-destructive/40 bg-destructive/10 text-destructive" : "";
  return <div className={`rounded-lg px-3 py-2 text-sm leading-5 ${placement} ${emphasis}`}>{children}</div>;
}

function companionError(error: unknown, copy: ReturnType<typeof usePortfolioCompanionCopy>["copy"]): string {
  if (error instanceof GatewayApiError) {
    if (error.status === 401) return copy.errorAuth;
    if (!error.status || error.status >= 500) return copy.errorUnavailable;
  }
  return copy.errorRejected;
}
