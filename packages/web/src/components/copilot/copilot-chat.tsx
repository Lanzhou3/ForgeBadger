"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, Bot, MessageSquare, PanelLeft, Square } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { CopilotStatusBar } from "@/components/copilot/copilot-runtime-panel";
import {
  MessageRow,
  PendingActionRow,
  StreamingMessage,
  ThinkingSection,
  indexToolResults,
} from "@/components/copilot/copilot-message-primitives";
import { CopilotSettings } from "@/components/copilot/copilot-settings";
import { CopilotManagementPanel } from "@/components/copilot/CopilotManagementPanel";
import { ConversationSidebar } from "@/components/copilot/conversation-sidebar";
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
} from "@/lib/copilot-api";

const AUTO_TITLE_MAX_CHARS = 24;

/**
 * Copilot console — the primary conversational surface, laid out as a
 * ChatGPT/Claude-style two-column workbench: conversation history management
 * on the left (new / search / rename / delete, collapsible on desktop and a
 * Sheet on mobile), and a centered, width-capped message stream in the middle
 * with a runtime status bar, markdown rendering, collapsible tool steps,
 * approval cards, streaming tolerance, and a floating composer card. All
 * Copilot tool preferences live behind the top-right gear button on the
 * dedicated /copilot/settings page.
 */
export function CopilotChat() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  // Deep link: /copilot?c=<conversationId> (e.g. "expand to full console" from
  // the robot chat panel) selects that conversation.
  const requestedConversationId = searchParams.get("c");

  const [conversations, setConversations] = useState<CopilotConversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState(false);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [managementOpen, setManagementOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarSheetOpen, setSidebarSheetOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastSentRef = useRef<string>("");
  const conversationIdRef = useRef<string | null>(null);
  conversationIdRef.current = conversationId;
  const requestedConversationRef = useRef<string | null>(null);
  requestedConversationRef.current = requestedConversationId;

  const refreshConversations = useCallback(async () => {
    try {
      const { conversations: next } = await listConversations();
      setConversations(next);
      if (!conversationIdRef.current) {
        const requested = requestedConversationRef.current;
        const target = (requested ? next.find((item) => item.id === requested) : undefined) ?? next[0];
        if (target) {
          void selectConversation(target.id);
        }
      }
    } catch {
      setLoadError(t("copilot.loadError"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectConversation = useCallback(async (id: string) => {
    conversationIdRef.current = id;
    setConversationId(id);
    setLoadError(null);
    setSendError(false);
    try {
      const { messages: next } = await listMessages(id);
      if (conversationIdRef.current === id) setMessages(next);
      setPinnedToBottom(true);
    } catch {
      setLoadError(t("copilot.loadError"));
    }
  }, [t]);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  // Deep-link follow-up: same-page client navigation (robot panel "expand"
  // while already on /copilot) does not remount this component, so react to
  // search-param changes explicitly. If the id is not in the loaded list it
  // may simply be stale (e.g. the panel just created it server-side), so
  // refresh the list once per requested id before giving up.
  const deepLinkRetriedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!requestedConversationId || requestedConversationId === conversationId) return;
    if (conversations.some((item) => item.id === requestedConversationId)) {
      void selectConversation(requestedConversationId);
      return;
    }
    if (deepLinkRetriedRef.current !== requestedConversationId) {
      deepLinkRetriedRef.current = requestedConversationId;
      void refreshConversations();
    }
  }, [requestedConversationId, conversations, conversationId, selectConversation, refreshConversations]);

  // Refresh the conversation list when the reactive loop opens a fresh
  // proactive conversation, so its report becomes visible.
  const { active, startRun, startEditedRun, approveAction, clearActive, markPending, reconcile, syncError } = useCopilotRun({
    conversationId,
    onSettled: async (id) => {
      const { messages: next } = await listMessages(id);
      if (conversationIdRef.current === id) setMessages(next);
      await refreshConversations();
    },
    onReactiveUpdate: refreshConversations,
    onTitleUpdated: ({ conversationId, title }) => {
      // Patch the in-memory list first so the sidebar + header update without
      // a roundtrip; the next refresh will reconcile any drift.
      setConversations((current) =>
        current.map((item) => (item.id === conversationId ? { ...item, title } : item))
      );
    },
  });

  const newConversation = useCallback(async (grantId?: string) => {
    setCreating(true);
    try {
      const { conversation } = await createConversation(undefined, grantId);
      await refreshConversations();
      await selectConversation(conversation.id);
    } catch (error) {
      setLoadError(t("copilot.loadError"));
      if (grantId) throw error;
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
    if (!text || !id || sending || (active && ["pending", "running", "awaiting_approval"].includes(active.status))) return;
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
    // Show the "thinking" pulse immediately; the first run event can lag the
    // POST while the Gateway starts the model turn.
    markPending(id);
    try {
      await startRun(id, text);
      const wasUntitled = !conversations.find((item) => item.id === id)?.title;
      if (wasUntitled) {
        await renameConversation(id, text.slice(0, AUTO_TITLE_MAX_CHARS)).catch(() => undefined);
      }
      await reloadActiveConversation(id);
    } catch {
      clearActive();
      setSendError(true);
    } finally {
      setSending(false);
    }
  }, [input, conversationId, sending, active, conversations, startRun, clearActive, markPending, reloadActiveConversation]);

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
    try {
      await cancelRun(active.runId);
      await reconcile();
    } catch { setLoadError("取消未确认，请同步状态后重试。"); }
    const id = active.conversationId;
    if (id) await reloadActiveConversation(id);
  }, [active, reconcile, reloadActiveConversation]);

  const onDecide = useCallback(
    async (approved: boolean) => {
      if (!active?.pendingAction) return;
      await approveAction(active.runId, active.pendingAction.id, approved);
      await reloadActiveConversation(active.conversationId);
    },
    [active, approveAction, reloadActiveConversation]
  );

  const beginEditMessage = useCallback((message: CopilotMessage) => {
    setEditingMessageId(message.id);
    setEditDraft(message.content);
    setEditError(null);
  }, []);

  const cancelEditMessage = useCallback(() => {
    setEditingMessageId(null);
    setEditDraft("");
    setEditError(null);
  }, []);

  const submitEditMessage = useCallback(async () => {
    const id = conversationId;
    const targetId = editingMessageId;
    const content = editDraft.trim();
    if (!id || !targetId || !content || editSubmitting) return;
    setEditSubmitting(true);
    setEditError(null);
    clearActive();
    try {
      await startEditedRun(id, targetId, content);
      setEditingMessageId(null);
      setEditDraft("");
      const id2 = conversationIdRef.current;
      if (id2) await reloadActiveConversation(id2);
    } catch {
      setEditError(t("copilot.editFailed"));
    } finally {
      setEditSubmitting(false);
    }
  }, [
    conversationId,
    editingMessageId,
    editDraft,
    editSubmitting,
    clearActive,
    startEditedRun,
    reloadActiveConversation,
    t
  ]);

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

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const activeConversation = conversations.find((item) => item.id === conversationId);
  const isRunning = active && (active.status === "running" || active.status === "pending");
  const isBusy = Boolean(isRunning || active?.status === "awaiting_approval");

  // Index tool_result rows by their provider toolCallId so MessageRow can pair
  // them with the corresponding tool_call row and render a single status
  // icon (running / ok / error / denied) instead of two loose <details>.
  const toolResultById = useMemo(() => indexToolResults(messages), [messages]);

  return (
    <div className="mx-auto flex h-full w-full max-w-[1600px] gap-4 p-4 md:p-6">
      <Sheet open={managementOpen} onOpenChange={setManagementOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}>
          <SheetTitle className="px-4 pt-4">授权与项目管理</SheetTitle>
          {managementOpen && (
            <CopilotManagementPanel
              boundGrantId={activeConversation?.grantId}
              onStartConversation={async id => {
                await newConversation(id);
                setManagementOpen(false);
              }}
            />
          )}
        </SheetContent>
      </Sheet>
      {sidebarOpen && (
        <Card className="hidden max-h-[calc(100vh-6rem)] w-[280px] shrink-0 flex-col overflow-hidden md:flex">
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
      )}

      <Card className="flex max-h-[calc(100vh-6rem)] min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-1">
            {/* Mobile: opens the conversation Sheet; desktop: toggles the column. */}
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 md:hidden"
              aria-label={t("copilot.conversations")}
              onClick={() => setSidebarSheetOpen(true)}
            >
              <PanelLeft className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="hidden shrink-0 md:inline-flex"
              aria-label={t("copilot.toggleConversations")}
              onClick={toggleSidebar}
            >
              <PanelLeft className="size-4" />
            </Button>
            <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold">
              <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
              {activeConversation?.title || t("copilot.untitled")}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {isRunning ? (
              <Badge variant="outline" className="gap-1 border-brand/40 text-xs">
                <span className="size-1.5 animate-pulse rounded-full bg-brand" />
                {t("copilot.running")}
              </Badge>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => setManagementOpen(true)}>授权与项目</Button>
            <CopilotSettings />
          </div>
        </div>

        <CopilotStatusBar />
        {activeConversation?.grantId && (
          <p className="border-b px-3 py-2 text-xs text-muted-foreground">
            此会话绑定项目授权，范围不可切换。
            <button className="ml-2 underline" onClick={() => setManagementOpen(true)}>查看授权</button>
          </p>
        )}

        <div className="relative flex min-h-0 flex-1 flex-col">
          <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-4">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
              {loadError && <p className="text-sm text-destructive">{loadError}</p>}
              {!loadError && messages.length === 0 && !active && (
                <EmptyState onSuggestion={(text) => void send(text)} />
              )}
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
                    isEditing={editingMessageId === message.id}
                    editDraft={editDraft}
                    editError={editError}
                    editSubmitting={editSubmitting}
                    canEdit={!isBusy && editingMessageId === null}
                    onBeginEdit={beginEditMessage}
                    onChangeDraft={setEditDraft}
                    onSubmitEdit={submitEditMessage}
                    onCancelEdit={cancelEditMessage}
                  />
                );
              })}
              {(syncError || active?.error) && <p role="status" className="text-sm text-muted-foreground">{syncError || active?.error}</p>}
              {active?.thinking ? (
                <ThinkingSection text={active.thinking} />
              ) : null}
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
          </div>
          {!pinnedToBottom && (
            <Button
              variant="outline"
              size="icon"
              className="absolute bottom-3 right-3 z-10 size-8 rounded-full shadow"
              onClick={scrollToBottom}
              aria-label={t("copilot.scrollDown")}
            >
              <ArrowDown className="size-4" />
            </Button>
          )}
        </div>

        {/* Floating composer: no docked bottom bar; the upward gradient fades
            messages out beneath the elevated input card, which lifts on hover
            and glows brand on focus. */}
        <div className="relative shrink-0 px-3 pb-3 pt-1">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-full h-10 bg-gradient-to-t from-card via-card/80 to-transparent"
          />
          <div
            data-testid="copilot-composer"
            className="flex items-end gap-2 rounded-xl border border-border/70 bg-card/90 px-2.5 py-2 shadow-lg shadow-black/20 backdrop-blur-md transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-border hover:shadow-xl hover:shadow-black/30 focus-within:border-brand/60 focus-within:shadow-xl focus-within:shadow-black/30 focus-within:ring-1 focus-within:ring-brand/30"
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
              className="min-h-[44px] max-h-40 flex-1 resize-none rounded-none border-0 bg-transparent px-1 py-1 shadow-none focus-visible:ring-0"
              rows={2}
            />
            {isRunning ? (
              <Button
                variant="outline"
                size="icon"
                className="size-9 shrink-0 rounded-full"
                onClick={() => void stopRun()}
                aria-label={t("copilot.stop")}
                title={t("copilot.stop")}
              >
                <Square className="size-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="size-9 shrink-0 rounded-full"
                onClick={() => void send()}
                disabled={sending || isBusy || !input.trim() || !conversationId}
                aria-label={t("copilot.send")}
                title={t("copilot.send")}
              >
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Sheet open={sidebarSheetOpen} onOpenChange={setSidebarSheetOpen}>
        <SheetContent side="left" className="w-80 p-0">
          <SheetTitle className="sr-only">{t("copilot.conversations")}</SheetTitle>
          <ConversationSidebar
            conversations={conversations}
            activeId={conversationId}
            creating={creating}
            onSelect={(id) => {
              setSidebarSheetOpen(false);
              void selectConversation(id);
            }}
            onCreate={() => {
              setSidebarSheetOpen(false);
              void newConversation();
            }}
            onRename={onRename}
            onDelete={onDelete}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
function EmptyState({ onSuggestion }: { onSuggestion: (text: string) => void }) {
  const { t } = useLanguage();
  const suggestions = [t("copilot.suggestion1"), t("copilot.suggestion2"), t("copilot.suggestion3")];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl border border-border/60 bg-muted/60 shadow-inner">
        <Bot className="size-6 text-muted-foreground" />
      </span>
      <div>
        <p className="text-base font-semibold">{t("copilot.welcomeTitle")}</p>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
          {t("copilot.welcomeSubtitle")}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => onSuggestion(suggestion)}
            className="rounded-full border border-border/70 bg-card px-3.5 py-1.5 text-sm text-muted-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand/60 hover:text-foreground hover:shadow-md"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
