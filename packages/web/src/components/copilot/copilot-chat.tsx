"use client";
import { CopilotRunOptions } from "./CopilotRunOptions";
import { CopilotFollowupQueue } from "./CopilotFollowupQueue";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowDown, ArrowUp, Bot, ListTodo, MessageSquare, PanelLeft, Square } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { CopilotStatusBar } from "@/components/copilot/copilot-runtime-panel";
import {
  MessageRow,
  StreamingMessage,
  ThinkingSection,
  indexToolResults,
} from "@/components/copilot/copilot-message-primitives";
import { CopilotSettings } from "@/components/copilot/copilot-settings";
import { ConversationSidebar } from "@/components/copilot/conversation-sidebar";
import { CopilotApproval } from "@/components/copilot/CopilotApproval";
import { GatewayApiError, listProjects, type Project } from "@/lib/api";
import { readLastCopilotConversation, writeLastCopilotConversation } from "@/lib/copilot-conversation-storage";
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
  const { t, language } = useLanguage();
  const searchParams = useSearchParams();
  // Deep link: /copilot?c=<conversationId> (e.g. "expand to full console" from
  // the robot chat panel) selects that conversation.
  const requestedConversationId = searchParams.get("c");

  const [conversations, setConversations] = useState<CopilotConversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [projectError, setProjectError] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [reviewTaskResults, setReviewTaskResults] = useState(false);
  const [repairFailedChecks, setRepairFailedChecks] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sendError, setSendError] = useState(false);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarSheetOpen, setSidebarSheetOpen] = useState(false);
  // null = follow the server-side preference / platform default; the status
  // bar back-fills this mirror whenever the effective preference changes.
  const [modelId, setModelId] = useState<string | null>(null);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const onModelChange = useCallback((next: string | null) => {
    setModelId(next);
  }, []);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastSentRef = useRef<{ conversationId: string; text: string; projectId?: string; modelId?: string; clientRequestId: string; reviewTaskResults?: boolean; repairFailedChecks?: boolean } | null>(null);
  const lastEditRef = useRef<{ signature: string; clientRequestId: string; reviewTaskResults?: boolean; repairFailedChecks?: boolean } | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  conversationIdRef.current = conversationId;
  const requestedConversationRef = useRef<string | null>(null);
  requestedConversationRef.current = requestedConversationId;
  const previousRequestedRef = useRef(requestedConversationId);
  // Out-of-order guard: a slow listMessages for one conversation must never
  // overwrite the stream the user has since switched to.
  const messageSerialRef = useRef(0);
  const listSerialRef = useRef(0);
  const selectionEpochRef = useRef(0);
  // The ?c= deep link is consumed once: after it has been applied — or the
  // user has picked a conversation manually — it must stop fighting the
  // sidebar for the selection.
  const deepLinkPendingRef = useRef(Boolean(requestedConversationId));

  const readMessages = useCallback(async (id: string) => {
    if (conversationIdRef.current !== id) return false;
    const serial = ++messageSerialRef.current;
    const epoch = selectionEpochRef.current;
    const current = () => serial === messageSerialRef.current && epoch === selectionEpochRef.current && conversationIdRef.current === id;
    try {
      const { messages: next } = await listMessages(id);
      if (!current()) return false;
      setMessages(next);
      return true;
    } catch (error) {
      if (current()) throw error;
      return false;
    }
  }, []);

  const selectConversation = useCallback(async (id: string) => {
    const epoch = ++selectionEpochRef.current;
    conversationIdRef.current = id;
    setConversationId(id);
    // Shared with the floating robot panel so the next panel open resumes
    // the conversation the user was last working in here.
    writeLastCopilotConversation(id);
    setLoadError(null);
    setActionError(null);
    setSendError(false);
    setSending(false);
    setEditingMessageId(null);
    setEditDraft("");
    setEditError(null);
    setEditSubmitting(false);
    setProjectId("");
    lastSentRef.current = null;
    lastEditRef.current = null;
    // A user-initiated switch retires any pending deep link, so the URL can
    // no longer pull the selection back.
    deepLinkPendingRef.current = false;
    setMessages([]);
    setLoadingMessages(true);
    try {
      if (await readMessages(id)) setPinnedToBottom(true);
    } catch {
      if (conversationIdRef.current === id) setLoadError(t("copilot.loadError"));
    } finally {
      if (selectionEpochRef.current === epoch) setLoadingMessages(false);
    }
  }, [readMessages, t]);

  const refreshConversations = useCallback(async () => {
    const serial = ++listSerialRef.current;
    try {
      const { conversations: next } = await listConversations();
      if (serial !== listSerialRef.current) return;
      setConversations(next);
      if (!conversationIdRef.current || deepLinkPendingRef.current) {
        const requested = deepLinkPendingRef.current ? requestedConversationRef.current : readLastCopilotConversation();
        const target = (requested ? next.find((item) => item.id === requested) : undefined) ?? next[0];
        if (target) void selectConversation(target.id);
      }
      return next;
    } catch {
      if (serial === listSerialRef.current) setLoadError(t("copilot.loadError"));
    } finally {
      if (serial === listSerialRef.current) setLoadingConversations(false);
    }
  }, [selectConversation, t]);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    let cancelled = false;
    setProjectError(false);
    void listProjects()
      .then((result) => {
        if (cancelled) return;
        setProjects(result.projects);
      }).catch(() => { if (!cancelled) { setProjects([]); setProjectError(true); } });
    return () => { cancelled = true; };
  }, []);

  // Deep-link follow-up: same-page client navigation (robot panel "expand"
  // while already on /copilot) does not remount this component, so react to
  // search-param changes explicitly. If the id is not in the loaded list it
  // may simply be stale (e.g. the panel just created it server-side), so
  // refresh the list once before giving up.
  useEffect(() => {
    if (previousRequestedRef.current === requestedConversationId) return;
    previousRequestedRef.current = requestedConversationId;
    deepLinkPendingRef.current = Boolean(requestedConversationId);
    if (!requestedConversationId) return;
    void refreshConversations();
  }, [requestedConversationId, refreshConversations]);

  // Refresh the conversation list when the reactive loop opens a fresh
  // proactive conversation, so its report becomes visible.
  const { active, startRun, startEditedRun, clearActive, markPending, reconcile, syncError } = useCopilotRun({
    conversationId,
    onSettled: async (id) => {
      await readMessages(id);
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
    await Promise.all([readMessages(id), refreshConversations()]);
  }, [readMessages, refreshConversations]);

  const send = useCallback(async (textOverride?: string, retry = false) => {
    const prior = retry ? lastSentRef.current : null;
    const text = (prior?.text ?? textOverride ?? input).trim();
    const id = conversationId;
    if (!text || !id || sending || savingPreferences || (active && ["pending", "running", "awaiting_approval"].includes(active.status))) return;
    if (retry && (!prior || prior.conversationId !== id)) return;
    const epoch = selectionEpochRef.current;
    messageSerialRef.current++;
    const request = prior ?? { conversationId: id, text, ...(projectId ? { projectId } : {}), ...(modelId ? { modelId } : {}), clientRequestId: crypto.randomUUID(), reviewTaskResults, repairFailedChecks };
    lastSentRef.current = request;
    if (!retry) setMessages((current) => [
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
      await startRun(id, text, request.modelId, { ...(request.projectId ? { projectId: request.projectId } : {}), clientRequestId: request.clientRequestId, ...(request.repairFailedChecks ? {repairFailedChecks:true}:{}), ...(request.reviewTaskResults ? { reviewTaskResults: true } : {}) });
      if (epoch !== selectionEpochRef.current) return;
      const wasUntitled = !conversations.find((item) => item.id === id)?.title;
      if (wasUntitled) {
        await renameConversation(id, text.slice(0, AUTO_TITLE_MAX_CHARS)).catch(() => undefined);
      }
      await reloadActiveConversation(id).catch(() => {
        if (selectionEpochRef.current === epoch) setLoadError(t("copilot.loadError"));
      });
    } catch {
      if (selectionEpochRef.current === epoch) {
        clearActive();
        setSendError(true);
      }
    } finally {
      if (selectionEpochRef.current === epoch) setSending(false);
    }
  }, [input, projectId, modelId, conversationId, reviewTaskResults, repairFailedChecks, sending, savingPreferences, active, conversations, startRun, clearActive, markPending, reloadActiveConversation, t]);

  const onRename = useCallback(async (id: string, title: string) => {
    setActionError(null);
    try {
      await renameConversation(id, title);
      await refreshConversations();
    } catch { setActionError(t("copilot.renameFailed")); }
  }, [refreshConversations, t]);

  const onDelete = useCallback(async (id: string) => {
    setActionError(null);
    try {
      await deleteConversation(id);
    } catch (error) {
      if (!(error instanceof GatewayApiError && error.status === 404)) {
        setActionError(t(error instanceof GatewayApiError && error.details?.code === "COPILOT_CONVERSATION_BUSY"
          ? "copilot.deleteBusy" : "copilot.deleteFailed"));
        return;
      }
    }
    listSerialRef.current++;
    setConversations(current => current.filter(item => item.id !== id));
    if (conversationIdRef.current === id) {
      selectionEpochRef.current++;
      messageSerialRef.current++;
      conversationIdRef.current = null;
      clearActive();
      setConversationId(null);
      setMessages([]);
      setSending(false);
      setSendError(false);
      setEditingMessageId(null);
      setEditSubmitting(false);
      lastSentRef.current = null;
      writeLastCopilotConversation(null);
    }
    await refreshConversations();
  }, [clearActive, refreshConversations, t]);

  const stopRun = useCallback(async () => {
    if (!active?.runId) return;
    const epoch = selectionEpochRef.current;
    try {
      await cancelRun(active.runId);
      await reconcile();
      if (active.conversationId) await reloadActiveConversation(active.conversationId);
    } catch {
      if (epoch === selectionEpochRef.current) setActionError(t("copilot.cancelFailed"));
    }
  }, [active, reconcile, reloadActiveConversation, t]);

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
    if (!id || !targetId || !content || editSubmitting || savingPreferences || sending) return;
    const epoch = selectionEpochRef.current;
    messageSerialRef.current++;
    const signature = JSON.stringify([id, targetId, content, projectId, modelId]);
    const request = lastEditRef.current?.signature === signature ? lastEditRef.current : { signature, clientRequestId: crypto.randomUUID(), reviewTaskResults, repairFailedChecks };
    lastEditRef.current = request;
    setEditSubmitting(true);
    setEditError(null);
    clearActive();
    try {
      await startEditedRun(id, targetId, content, { clientRequestId: request.clientRequestId, ...(projectId ? { projectId } : {}), ...(modelId ? { modelId } : {}), ...(request.repairFailedChecks ? {repairFailedChecks:true}:{}), ...(request.reviewTaskResults ? { reviewTaskResults: true } : {}) });
      if (epoch !== selectionEpochRef.current) return;
      setEditingMessageId(null);
      setEditDraft("");
      lastEditRef.current = null;
      await reloadActiveConversation(id).catch(() => {
        if (epoch === selectionEpochRef.current) setLoadError(t("copilot.loadError"));
      });
    } catch {
      if (epoch === selectionEpochRef.current) setEditError(t("copilot.editFailed"));
    } finally {
      if (epoch === selectionEpochRef.current) setEditSubmitting(false);
    }
  }, [
    conversationId,
    editingMessageId,
    editDraft,
    editSubmitting,
    reviewTaskResults, repairFailedChecks,
    savingPreferences,
    sending,
    projectId,
    modelId,
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
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1600px] gap-4 p-2 md:p-6">
      {sidebarOpen && (
        <Card className="hidden min-h-0 w-[280px] shrink-0 flex-col gap-0 overflow-hidden py-0 md:flex">
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

      <Card className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden py-0">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b py-2 pr-3 pl-14 md:pl-3">
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
          <div className="flex shrink-0 items-center gap-1">
            {isRunning ? (
              <Badge variant="outline" className="gap-1 border-brand/40 text-xs">
                <span className="size-1.5 animate-pulse rounded-full bg-brand" />
                <span className="sr-only sm:not-sr-only">{t("copilot.running")}</span>
              </Badge>
            ) : null}
            <Link href="/copilot/tasks" aria-label={language === "zh-CN" ? "开发任务" : "Development tasks"} title={language === "zh-CN" ? "开发任务" : "Development tasks"} className="shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
              <ListTodo className="size-4 sm:hidden" />
              <span className="hidden sm:inline">{language === "zh-CN" ? "开发任务" : "Development tasks"}</span>
            </Link>
            <CopilotSettings />
          </div>
        </div>

        <CopilotStatusBar onModelChange={onModelChange} onSavingChange={setSavingPreferences} controlsDisabled={isBusy || sending} />
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div ref={scrollRef} onScroll={onScroll} role="region" aria-label={t("copilot.conversations")} data-testid="copilot-message-history" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
              {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
              {loadError && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
                <p>{loadError}</p>
                <Button size="sm" variant="outline" onClick={() => void (conversationId ? selectConversation(conversationId) : refreshConversations())}>{t("copilot.retry")}</Button>
              </div>}
              {(loadingConversations || loadingMessages) && <p role="status" className="text-sm text-muted-foreground">{t("common.loading")}</p>}
              {!loadError && !loadingConversations && !loadingMessages && messages.length === 0 && !active && (
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
                    editSubmitting={editSubmitting || savingPreferences}
                    canEdit={!isBusy && !savingPreferences && !sending && editingMessageId === null}
                    onBeginEdit={beginEditMessage}
                    onChangeDraft={setEditDraft}
                    onSubmitEdit={submitEditMessage}
                    onCancelEdit={cancelEditMessage}
                  />
                );
              })}
              {(syncError || active?.error) && <p role="status" className="text-sm text-muted-foreground">{syncError || active?.error}</p>}
              {active?.status === "awaiting_approval" && (active.pendingAction
                ? <CopilotApproval key={active.pendingAction.id} action={active.pendingAction} onDecided={reconcile} />
                : <p role="status" className="text-sm text-muted-foreground">{t("copilot.awaitingApproval")}</p>)}
              {conversationId && <CopilotFollowupQueue active={isBusy} key={conversationId} conversationId={conversationId}
                {...(projectId ? { projectId } : {})} {...(modelId ? { modelId } : {})} />}
              {isRunning && <p role="status" className="text-xs text-muted-foreground">
                {({ context: '正在整理上下文', summarizing: '正在压缩历史记录', model: '正在请求模型', tool: '正在执行工具', queued: '等待执行' } as Record<string, string>)[active?.phase ?? 'queued'] ?? '正在执行'}
              </p>}
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
              {sendError && (
                <div className="flex items-center gap-2">
                  <p className="text-sm text-destructive">{t("copilot.sendError")}</p>
                  <Button variant="outline" size="sm" onClick={() => void send(undefined, true)}>
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
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <label htmlFor="copilot-project-context" className="shrink-0">{t("copilot.projectContext")}</label>
            <select id="copilot-project-context" value={projectId}
              disabled={isBusy || sending}
              onChange={event => setProjectId(event.target.value)}
              className="min-w-0 max-w-60 flex-1 rounded-md border border-border bg-background px-2 py-1 text-foreground">
              <option value="">{t("copilot.noProject")}</option>
              {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            {projectError ? <span role="status">{t("copilot.projectLoadError")}</span> : null}
            <CopilotRunOptions
              conversationId={conversationId} modelId={modelId}
              disabled={isBusy || sending}
              reviewTaskResults={reviewTaskResults} onReviewChange={setReviewTaskResults}
              repairFailedChecks={repairFailedChecks} onRepairChange={setRepairFailedChecks}
            />
          </div>
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
            {isBusy ? (
              <Button
                variant="outline"
                size="icon"
                className="size-9 shrink-0 rounded-full"
                onClick={() => void stopRun()}
                disabled={!active?.runId}
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
                disabled={sending || savingPreferences || isBusy || !input.trim() || !conversationId}
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
        <SheetContent side="left" className="w-80 p-0" aria-describedby={undefined}
          onEscapeKeyDown={event => {
            // First Escape cancels inline renaming, retaining the history list.
            if (event.target instanceof HTMLElement && event.target.hasAttribute("data-conversation-rename")) event.preventDefault();
          }}>
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
