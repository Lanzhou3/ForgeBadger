"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Maximize2, Square, SquarePen, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  MessageRow,
  StreamingMessage,
  ThinkingSection,
  indexToolResults,
} from "@/components/copilot/copilot-message-primitives";
import { useLanguage } from "@/hooks/use-language";
import { useCopilotRun } from "@/hooks/use-copilot";
import {
  cancelRun,
  createConversation,
  listMessages,
  renameConversation,
  type CopilotMessage,
} from "@/lib/copilot-api";
import { cn } from "@/lib/utils";
import { GatewayApiError } from "@/lib/api";
import { CopilotApproval } from "@/components/copilot/CopilotApproval";
import { LAST_COPILOT_CONVERSATION_KEY, readLastCopilotConversation, writeLastCopilotConversation } from "@/lib/copilot-conversation-storage";

const AUTO_TITLE_MAX_CHARS = 24;
// Shared with the full /copilot console — keep the same storage key so both
// surfaces resume the conversation the user last worked in.
export const ROBOT_CONVERSATION_STORAGE_KEY = LAST_COPILOT_CONVERSATION_KEY;

interface RobotChatPanelProps {
  onClose: () => void;
  /** Expand to the full Copilot console, carrying the current conversation. */
  onExpandFull: (conversationId: string | null) => void;
}

/**
 * Floating quick-chat panel anchored above the robot (Linear/v0-style
 * side assistant). Desktop: a 380x520 card pinned to the bottom-right corner;
 * small screens: a near-fullscreen bottom sheet. Conversations are created
 * lazily on the first message (no empty-conversation litter) and the active
 * conversation id persists in localStorage so reopening the panel resumes the
 * same conversation.
 */
export function RobotChatPanel({ onClose, onExpandFull }: RobotChatPanelProps) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    inputRef.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState(false);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastSentRef = useRef<{ text: string; conversationId: string | null; clientRequestId: string } | null>(null);
  const selectionEpochRef = useRef(0);
  const messageSerialRef = useRef(0);
  const conversationIdRef = useRef<string | null>(null);
  conversationIdRef.current = conversationId;

  const reloadMessages = useCallback(async (id: string) => {
    if (conversationIdRef.current !== id) return;
    const serial = ++messageSerialRef.current;
    const epoch = selectionEpochRef.current;
    const current = () => serial === messageSerialRef.current && epoch === selectionEpochRef.current && conversationIdRef.current === id;
    try {
      const { messages: next } = await listMessages(id);
      if (current()) { setMessages(next); setLoadError(null); }
    } catch (error) {
      if (current()) throw error;
    }
  }, []);

  const { active, startRun, clearActive, markPending, reconcile, syncError } = useCopilotRun({
    conversationId,
    onSettled: reloadMessages,
  });

  // Restore the previous conversation on mount; a stale id (deleted on the
  // server) is dropped so the panel falls back to a fresh draft. Runs that
  // finished while the panel was hidden (expanded to the console, tab
  // switched, …) are covered by useCopilotRun's focus/online/reconnect
  // reconciliation, which reloads the durable messages via onSettled.
  useEffect(() => {
    const stored = readLastCopilotConversation();
    if (!stored) return;
    let disposed = false;
    const epoch = selectionEpochRef.current;
    const serial = ++messageSerialRef.current;
    setRestoring(true);
    conversationIdRef.current = stored;
    setConversationId(stored);
    listMessages(stored)
      .then(({ messages: next }) => {
        if (!disposed && serial === messageSerialRef.current && epoch === selectionEpochRef.current && conversationIdRef.current === stored) setMessages(next);
      })
      .catch((error: unknown) => {
        if (disposed || epoch !== selectionEpochRef.current || conversationIdRef.current !== stored) return;
        if (error instanceof GatewayApiError && error.status === 404) {
          conversationIdRef.current = null;
          writeLastCopilotConversation(null);
          setConversationId(null);
          setMessages([]);
          clearActive();
        } else setLoadError(t("copilot.loadError"));
      })
      .finally(() => { if (!disposed && epoch === selectionEpochRef.current) setRestoring(false); });
    return () => { disposed = true; };
  }, [clearActive, t]);

  const send = useCallback(async (textOverride?: string, retry = false) => {
    const prior = retry ? lastSentRef.current : null;
    const text = (prior?.text ?? textOverride ?? input).trim();
    if (!text || sending || restoring || (active && ["pending", "running", "awaiting_approval"].includes(active.status))) return;
    if (retry && (!prior || prior.conversationId !== conversationId)) return;
    const request = prior ?? { text, conversationId, clientRequestId: crypto.randomUUID() };
    lastSentRef.current = request;
    const epoch = selectionEpochRef.current;
    messageSerialRef.current++;
    setPinnedToBottom(true);
    if (!retry) setMessages((current) => [
      ...current,
      {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        conversationId: conversationId ?? "",
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
    setLoadError(null);
    clearActive();
    // Show the "thinking" pulse immediately, covering the lazy conversation
    // creation and the sendMessage round-trip before any run event arrives.
    markPending(conversationId ?? "");
    try {
      let id = conversationId;
      if (!id) {
        // Lazy creation: the conversation only exists on the server once the
        // user actually sends something.
        const { conversation } = await createConversation();
        if (epoch !== selectionEpochRef.current) return;
        id = conversation.id;
        request.conversationId = id;
        conversationIdRef.current = id;
        setConversationId(id);
        writeLastCopilotConversation(id);
        await renameConversation(id, text.slice(0, AUTO_TITLE_MAX_CHARS)).catch(() => undefined);
      }
      if (epoch !== selectionEpochRef.current) return;
      await startRun(id, text, undefined, { clientRequestId: request.clientRequestId });
      if (epoch !== selectionEpochRef.current) return;
      await reloadMessages(id).catch(() => {
        if (epoch === selectionEpochRef.current) setLoadError(t("copilot.loadError"));
      });
    } catch {
      if (epoch === selectionEpochRef.current) { clearActive(); setSendError(true); }
    } finally {
      if (epoch === selectionEpochRef.current) setSending(false);
    }
  }, [input, sending, restoring, active, conversationId, clearActive, markPending, startRun, reloadMessages, t]);

  const newChat = useCallback(() => {
    selectionEpochRef.current++;
    messageSerialRef.current++;
    conversationIdRef.current = null;
    lastSentRef.current = null;
    clearActive();
    setConversationId(null);
    setMessages([]);
    setLoadError(null);
    setSendError(false);
    setSending(false);
    setRestoring(false);
    setInput("");
    writeLastCopilotConversation(null);
  }, [clearActive]);

  const stopRun = useCallback(async () => {
    if (!active?.runId) return;
    const epoch = selectionEpochRef.current;
    try {
      await cancelRun(active.runId);
      await reconcile();
      if (active.conversationId) await reloadMessages(active.conversationId);
    } catch { if (epoch === selectionEpochRef.current) setLoadError(t("copilot.cancelFailed")); }
  }, [active, reconcile, reloadMessages, t]);

  const onScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    setPinnedToBottom(distanceFromBottom < 80);
  }, []);

  // Follow the stream while the user is at the bottom; scrolling up pauses
  // follow mode so they can read undisturbed.
  useEffect(() => {
    if (pinnedToBottom) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [messages, active?.text, active?.thinking, pinnedToBottom]);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    setPinnedToBottom(true);
  }, []);

  const isRunning = active && (active.status === "running" || active.status === "pending");
  const isBusy = Boolean(isRunning || active?.status === "awaiting_approval");
  const toolResultById = useMemo(() => indexToolResults(messages), [messages]);
  const showEmpty = !loadError && !restoring && messages.length === 0 && !active;

  return (
    <div
      role="dialog"
      aria-label={t("nav.copilot")}
      data-testid="robot-chat-panel"
      onKeyDown={event => {
        if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); onClose(); }
      }}
      className="fixed inset-x-2 bottom-2 top-14 z-40 flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-black/40 md:inset-x-auto md:bottom-32 md:right-4 md:top-auto md:h-[520px] md:max-h-[calc(100dvh-9rem)] md:w-[380px]"
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              isRunning ? "animate-pulse bg-brand" : "bg-emerald-500"
            )}
            aria-hidden="true"
          />
          <span className="truncate text-sm font-semibold">{t("nav.copilot")}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            aria-label={t("copilot.robotExpand")}
            title={t("copilot.robotExpand")}
            onClick={() => onExpandFull(conversationId)}
          >
            <Maximize2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            aria-label={t("copilot.newConversation")}
            title={t("copilot.newConversation")}
            onClick={newChat}
          >
            <SquarePen className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            aria-label={t("common.close")}
            title={t("common.close")}
            onClick={onClose}
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          data-testid="robot-chat-scroll"
          className="flex-1 space-y-4 overflow-y-auto px-3 py-3"
        >
          {loadError && <p className="text-sm text-destructive">{loadError}</p>}
          {!loadError && restoring && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-brand" />
              {t("common.loading")}
            </p>
          )}
          {showEmpty && <PanelEmptyState onSuggestion={(text) => void send(text)} />}
          {messages.map((message) => {
            const pairedResultId = message.toolCallId && toolResultById.has(message.toolCallId)
              ? toolResultById.get(message.toolCallId)!.id
              : null;
            return (
              <MessageRow
                key={message.id}
                message={message}
                pairedResult={pairedResultId === null ? null : (toolResultById.get(message.toolCallId!) ?? null)}
                suppressRender={pairedResultId === message.id}
              />
            );
          })}
          {(syncError || active?.error) && <p role="status" className="text-sm text-muted-foreground">{syncError || active?.error}</p>}
          {active?.status === "awaiting_approval" && (active.pendingAction
            ? <CopilotApproval key={active.pendingAction.id} action={active.pendingAction} onDecided={reconcile} />
            : <p role="status" className="text-sm text-muted-foreground">{t("copilot.awaitingApproval")}</p>)}
          {active?.thinking ? <ThinkingSection text={active.thinking} live={isRunning === true} /> : null}
          {active?.text ? (
            <StreamingMessage text={active.text} />
          ) : isRunning ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-brand" />
              {t("copilot.running")}
            </p>
          ) : null}
          {sendError && (
            <div className="flex items-center gap-2">
              <p className="text-sm text-destructive">{t("copilot.sendError")}</p>
              <Button variant="outline" size="sm" onClick={() => void send(undefined, true)}>
                {t("copilot.retry")}
              </Button>
            </div>
          )}
        </div>
        {!pinnedToBottom && (
          <Button
            variant="outline"
            size="icon"
            className="absolute bottom-3 right-3 z-10 size-7 rounded-full shadow"
            onClick={scrollToBottom}
            aria-label={t("copilot.scrollDown")}
          >
            <ArrowDown className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Floating composer: no docked bottom bar. The upward gradient fades
          messages out beneath the elevated input card (Linear/v0 assistant
          pattern), and the card lifts on hover / glows on focus. */}
      <div className="relative shrink-0 px-2.5 pb-2.5 pt-1">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-full h-10 bg-gradient-to-t from-card via-card/80 to-transparent"
        />
        <div
          data-testid="robot-chat-composer"
          className="flex items-end gap-1.5 rounded-xl border border-border/70 bg-card/90 px-2 py-1.5 shadow-lg shadow-black/20 backdrop-blur-md transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-border hover:shadow-xl hover:shadow-black/30 focus-within:border-brand/60 focus-within:shadow-xl focus-within:shadow-black/30 focus-within:ring-1 focus-within:ring-brand/30"
        >
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={t("copilot.placeholder")}
            aria-label={t("copilot.placeholder")}
            className="min-h-[32px] max-h-32 flex-1 resize-none rounded-none border-0 bg-transparent px-1 py-1 shadow-none focus-visible:ring-0"
            rows={1}
          />
          {isBusy ? (
            <Button
              variant="outline"
              size="icon"
              className="size-7 shrink-0 rounded-full"
              onClick={() => void stopRun()}
              disabled={!active?.runId}
              aria-label={t("copilot.stop")}
              title={t("copilot.stop")}
            >
              <Square className="size-3.5" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="size-7 shrink-0 rounded-full"
              onClick={() => void send()}
              disabled={sending || restoring || isBusy || !input.trim()}
              aria-label={t("copilot.send")}
              title={t("copilot.send")}
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function PanelEmptyState({ onSuggestion }: { onSuggestion: (text: string) => void }) {
  const { t } = useLanguage();
  const suggestions = [
    t("copilot.robotSuggestion1"),
    t("copilot.robotSuggestion2"),
    t("copilot.suggestion3"),
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div>
        <p className="text-sm font-medium">{t("copilot.welcomeTitle")}</p>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">{t("copilot.welcomeSubtitle")}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onSuggestion(suggestion)}
            className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-brand/60 hover:text-foreground"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
