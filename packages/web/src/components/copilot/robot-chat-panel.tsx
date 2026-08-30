"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Maximize2, Square, SquarePen, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  MessageRow,
  PendingActionRow,
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

const AUTO_TITLE_MAX_CHARS = 24;
export const ROBOT_CONVERSATION_STORAGE_KEY = "openforge.copilot.robot-conversation";

interface RobotChatPanelProps {
  onClose: () => void;
  /** Expand to the full Copilot console, carrying the current conversation. */
  onExpandFull: (conversationId: string | null) => void;
}

/**
 * Floating quick-chat panel anchored above the pixel robot (Linear/v0-style
 * side assistant). Desktop: a 380x520 card pinned to the bottom-right corner;
 * small screens: a near-fullscreen bottom sheet. Conversations are created
 * lazily on the first message (no empty-conversation litter) and the active
 * conversation id persists in localStorage so reopening the panel resumes the
 * same conversation.
 */
export function RobotChatPanel({ onClose, onExpandFull }: RobotChatPanelProps) {
  const { t } = useLanguage();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState(false);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastSentRef = useRef<string>("");
  const conversationIdRef = useRef<string | null>(null);
  conversationIdRef.current = conversationId;

  const { active, startRun, approveAction, clearActive, markPending } = useCopilotRun();

  const reloadMessages = useCallback(async (id: string) => {
    const { messages: next } = await listMessages(id);
    if (conversationIdRef.current === id) setMessages(next);
  }, []);

  // Restore the previous conversation on mount; a stale id (deleted on the
  // server) is dropped so the panel falls back to a fresh draft.
  useEffect(() => {
    const stored = window.localStorage.getItem(ROBOT_CONVERSATION_STORAGE_KEY);
    if (!stored) return;
    setRestoring(true);
    setConversationId(stored);
    listMessages(stored)
      .then(({ messages: next }) => {
        if (conversationIdRef.current === stored) setMessages(next);
      })
      .catch(() => {
        window.localStorage.removeItem(ROBOT_CONVERSATION_STORAGE_KEY);
        if (conversationIdRef.current === stored) {
          setConversationId(null);
          setMessages([]);
        }
      })
      .finally(() => setRestoring(false));
  }, []);

  const send = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || sending) return;
    lastSentRef.current = text;
    setPinnedToBottom(true);
    setMessages((current) => [
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
        id = conversation.id;
        setConversationId(id);
        window.localStorage.setItem(ROBOT_CONVERSATION_STORAGE_KEY, id);
        await renameConversation(id, text.slice(0, AUTO_TITLE_MAX_CHARS)).catch(() => undefined);
      }
      await startRun(id, text);
      await reloadMessages(id);
    } catch {
      clearActive();
      setSendError(true);
    } finally {
      setSending(false);
    }
  }, [input, sending, conversationId, clearActive, markPending, startRun, reloadMessages]);

  const newChat = useCallback(() => {
    clearActive();
    setConversationId(null);
    setMessages([]);
    setLoadError(null);
    setSendError(false);
    window.localStorage.removeItem(ROBOT_CONVERSATION_STORAGE_KEY);
  }, [clearActive]);

  const stopRun = useCallback(async () => {
    if (!active?.runId) return;
    await cancelRun(active.runId).catch(() => undefined);
    clearActive();
    if (active.conversationId) await reloadMessages(active.conversationId);
  }, [active, clearActive, reloadMessages]);

  const onDecide = useCallback(
    async (approved: boolean) => {
      if (!active?.pendingAction) return;
      await approveAction(active.runId, active.pendingAction.id, approved);
      await reloadMessages(active.conversationId);
    },
    [active, approveAction, reloadMessages]
  );

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
  const toolResultById = useMemo(() => indexToolResults(messages), [messages]);
  const showEmpty = !loadError && !restoring && messages.length === 0 && !active;

  return (
    <div
      role="dialog"
      aria-label={t("nav.copilot")}
      data-testid="robot-chat-panel"
      className="fixed inset-x-2 bottom-2 top-14 z-40 flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-black/40 md:inset-x-auto md:bottom-24 md:right-4 md:top-auto md:h-[520px] md:w-[380px]"
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
          {active?.thinking ? <ThinkingSection text={active.thinking} live={isRunning === true} /> : null}
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
          {isRunning ? (
            <Button
              variant="outline"
              size="icon"
              className="size-7 shrink-0 rounded-full"
              onClick={() => void stopRun()}
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
              disabled={sending || !input.trim()}
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
