"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, Square, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { CopilotSettings } from "@/components/copilot/copilot-settings";
import { ConversationSidebar } from "@/components/copilot/conversation-sidebar";
import { MarkdownRenderer } from "@/components/projects/markdown-renderer";
import { useLanguage } from "@/hooks/use-language";
import { useCopilotRun } from "@/hooks/use-copilot";
import {
  cancelRun,
  createConversation,
  deleteConversation,
  listConversations,
  listMessages,
  renameConversation,
  type CopilotConversation,
  type CopilotMessage,
  type CopilotPendingAction,
} from "@/lib/copilot-api";

const AUTO_TITLE_MAX_CHARS = 24;

/**
 * Copilot chat — the primary conversational surface. A ChatGPT-style
 * two-pane layout: conversation history management on the left (new / search /
 * rename / delete), and the message stream with markdown rendering, collapsible
 * tool steps, approval cards, and a stop control on the right.
 */
export function CopilotChat() {
  const { t } = useLanguage();

  const [conversations, setConversations] = useState<CopilotConversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState(false);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastSentRef = useRef<string>("");
  const conversationIdRef = useRef<string | null>(null);
  conversationIdRef.current = conversationId;

  const refreshConversations = useCallback(async () => {
    try {
      const { conversations: next } = await listConversations();
      setConversations(next);
      const first = next[0];
      if (!conversationIdRef.current && first) {
        void selectConversation(first.id);
      }
    } catch {
      setLoadError(t("copilot.loadError"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectConversation = useCallback(async (id: string) => {
    setConversationId(id);
    setLoadError(null);
    setSendError(false);
    try {
      const { messages: next } = await listMessages(id);
      setMessages(next);
      setPinnedToBottom(true);
    } catch {
      setLoadError(t("copilot.loadError"));
    }
  }, [t]);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  // Refresh the conversation list when the reactive loop opens a fresh
  // proactive conversation, so its report becomes visible.
  const { active, startRun, approveAction, clearActive } = useCopilotRun({
    onReactiveUpdate: refreshConversations,
  });

  const newConversation = useCallback(async () => {
    setCreating(true);
    try {
      const { conversation } = await createConversation();
      await refreshConversations();
      await selectConversation(conversation.id);
    } catch {
      setLoadError(t("copilot.loadError"));
    } finally {
      setCreating(false);
    }
  }, [refreshConversations, selectConversation, t]);

  const reloadActiveConversation = useCallback(async (id: string) => {
    const [{ messages: next }] = await Promise.all([listMessages(id), refreshConversations()]);
    if (conversationIdRef.current === id) setMessages(next);
  }, [refreshConversations]);

  const send = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    const id = conversationId;
    if (!text || !id || sending) return;
    lastSentRef.current = text;
    setMessages((current) => [
      ...current,
      {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        conversationId: id,
        userId: "",
        role: "user",
        kind: "text",
        content: text,
        sequence: current.length + 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    if (!textOverride) setInput("");
    setSending(true);
    setSendError(false);
    clearActive();
    try {
      await startRun(id, text);
      const wasUntitled = !conversations.find((item) => item.id === id)?.title;
      if (wasUntitled) {
        await renameConversation(id, text.slice(0, AUTO_TITLE_MAX_CHARS)).catch(() => undefined);
      }
      await reloadActiveConversation(id);
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  }, [input, conversationId, sending, conversations, startRun, clearActive, reloadActiveConversation]);

  const onRename = useCallback(async (id: string, title: string) => {
    await renameConversation(id, title).catch(() => undefined);
    await refreshConversations();
  }, [refreshConversations]);

  const onDelete = useCallback(async (id: string) => {
    await deleteConversation(id).catch(() => undefined);
    if (conversationIdRef.current === id) {
      setConversationId(null);
      setMessages([]);
    }
    await refreshConversations();
  }, [refreshConversations]);

  const stopRun = useCallback(async () => {
    if (!active?.runId) return;
    await cancelRun(active.runId).catch(() => undefined);
    clearActive();
    const id = active.conversationId;
    if (id) await reloadActiveConversation(id);
  }, [active, clearActive, reloadActiveConversation]);

  const onDecide = useCallback(
    async (approved: boolean) => {
      if (!active?.pendingAction) return;
      await approveAction(active.runId, active.pendingAction.id, approved);
      await reloadActiveConversation(active.conversationId);
    },
    [active, approveAction, reloadActiveConversation]
  );

  const onScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    setPinnedToBottom(distanceFromBottom < 80);
  }, []);

  useEffect(() => {
    if (pinnedToBottom) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [messages, active?.text, pinnedToBottom]);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    setPinnedToBottom(true);
  }, []);

  const activeConversation = conversations.find((item) => item.id === conversationId);
  const isRunning = active && (active.status === "running" || active.status === "pending");

  return (
    <div className="mx-auto grid h-full max-w-7xl grid-cols-[280px_1fr] gap-4 p-6">
      <Card className="flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden">
        <ConversationSidebar
          conversations={conversations}
          activeId={conversationId}
          creating={creating}
          onSelect={(id) => void selectConversation(id)}
          onCreate={() => void newConversation()}
          onRename={onRename}
          onDelete={onDelete}
        />
      </Card>

      <Card className="flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
          <span className="truncate text-sm font-semibold">
            {activeConversation?.title || t("copilot.untitled")}
          </span>
          <div className="flex items-center gap-1">
            {isRunning ? (
              <Badge variant="outline" className="gap-1 border-brand/40 text-xs">
                <span className="size-1.5 animate-pulse rounded-full bg-brand" />
                {t("copilot.running")}
              </Badge>
            ) : null}
            <CopilotSettings />
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col">
          <div ref={scrollRef} onScroll={onScroll} className="flex-1 space-y-3 overflow-y-auto p-4">
            {loadError && <p className="text-sm text-destructive">{loadError}</p>}
            {!loadError && messages.length === 0 && !active && (
              <EmptyState onSuggestion={(text) => void send(text)} />
            )}
            {messages.map((message) => (
              <MessageRow key={message.id} message={message} />
            ))}
            {active?.text ? (
              <StreamingMessage text={active.text} />
            ) : isRunning ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="size-1.5 animate-pulse rounded-full bg-brand" />
                {t("copilot.running")}
              </p>
            ) : null}
            {active?.pendingAction && (
              <PendingActionRow action={active.pendingAction} onDecide={onDecide} />
            )}
            {sendError && (
              <div className="flex items-center gap-2">
                <p className="text-sm text-destructive">{t("copilot.sendError")}</p>
                <Button variant="outline" size="sm" onClick={() => void send(lastSentRef.current)}>
                  {t("copilot.retry")}
                </Button>
              </div>
            )}
          </div>
          {!pinnedToBottom && (
            <Button
              variant="outline"
              size="icon"
              className="absolute bottom-3 right-3 size-8 rounded-full shadow"
              onClick={scrollToBottom}
              aria-label={t("copilot.scrollDown")}
            >
              <ArrowDown className="size-4" />
            </Button>
          )}
        </div>

        <div className="border-t p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={t("copilot.placeholder")}
              className="min-h-[48px] max-h-40 flex-1 resize-none"
              rows={2}
            />
            {isRunning ? (
              <Button variant="outline" onClick={() => void stopRun()} aria-label={t("copilot.stop")}>
                <Square className="size-4" />
                {t("copilot.stop")}
              </Button>
            ) : (
              <Button onClick={() => void send()} disabled={sending || !input.trim() || !conversationId}>
                {t("copilot.send")}
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function EmptyState({ onSuggestion }: { onSuggestion: (text: string) => void }) {
  const { t } = useLanguage();
  const suggestions = [t("copilot.suggestion1"), t("copilot.suggestion2"), t("copilot.suggestion3")];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div>
        <p className="text-base font-medium">{t("copilot.welcomeTitle")}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{t("copilot.welcomeSubtitle")}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => onSuggestion(suggestion)}
            className="rounded-full border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-brand/60 hover:text-foreground"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

function StreamingMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm">
        <MarkdownRenderer content={text} />
        <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-[1px] bg-foreground/70 align-text-bottom" />
      </div>
    </div>
  );
}

function MessageRow({ message }: { message: CopilotMessage }) {
  const { t } = useLanguage();
  const isUser = message.role === "user";

  if (message.kind === "tool_call") {
    return (
      <details className="rounded-md border border-border/60 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
        <summary className="flex cursor-pointer items-center gap-1.5 font-medium">
          <Wrench className="size-3" />
          {t("copilot.toolCall")}{message.toolName ? `：${message.toolName}` : ""}
        </summary>
        {message.toolInputJson && (
          <pre className="mt-2 max-h-40 overflow-auto rounded bg-background p-2 text-[11px]">{message.toolInputJson}</pre>
        )}
      </details>
    );
  }
  if (message.kind === "tool_result") {
    return (
      <details className="max-w-[85%] rounded-md bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium">
          {t("copilot.toolResult")} — {truncateContent(message.content)}
        </summary>
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-background p-2 text-[11px]">{message.content}</pre>
      </details>
    );
  }
  if (message.kind === "error") {
    return <div className="text-sm text-destructive">{message.content}</div>;
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
          isUser ? "whitespace-pre-wrap bg-primary text-primary-foreground" : "bg-muted"
        }`}
      >
        {isUser ? message.content : <MarkdownRenderer content={message.content} />}
      </div>
    </div>
  );
}

function PendingActionRow({
  action,
  onDecide,
}: {
  action: CopilotPendingAction;
  onDecide: (approved: boolean) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/30">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">
          {t("copilot.approvalRequired")}
        </Badge>
        <span className="text-sm font-medium">{action.tool}</span>
      </div>
      {action.inputJson && (
        <pre className="max-h-40 overflow-auto rounded bg-background p-2 text-xs">{action.inputJson}</pre>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void onDecide(true)}>
          {t("copilot.approve")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void onDecide(false)}>
          {t("copilot.reject")}
        </Button>
      </div>
    </div>
  );
}

function truncateContent(content: string): string {
  const max = 80;
  return content.length > max ? `${content.slice(0, max)}…` : content;
}
