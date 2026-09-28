"use client";
import { CopilotRunOptions } from "./CopilotRunOptions";
import { CopilotFollowupQueue } from "./CopilotFollowupQueue";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowDown, ArrowUp, ListTodo, MessageSquare, PanelLeft, Square } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CopilotStatusBar } from "@/components/copilot/copilot-runtime-panel";
import {
  MessageRow,
  StreamingMessage,
  ThinkingSection,
  indexToolResults,
} from "@/components/copilot/copilot-message-primitives";
import { CopilotWelcomeState } from "@/components/copilot/copilot-empty-state";
import { CopilotSettings } from "@/components/copilot/copilot-settings";
import { ConversationSidebar } from "@/components/copilot/conversation-sidebar";
import { CopilotApproval } from "@/components/copilot/CopilotApproval";
import { GatewayApiError, listProjects, type Project } from "@/lib/api";
import { readLastCopilotConversation, writeLastCopilotConversation } from "@/lib/copilot-conversation-storage";
import { useLanguage } from "@/hooks/use-language";
import { useCopilotRun } from "@/hooks/use-copilot";
import { useCopilotChatController } from "@/hooks/use-copilot-chat-controller";
import { toast } from "@/lib/toast";
import type { TranslationKey } from "@/lib/i18n";
import {
  createConversation,
  deleteConversation,
  listConversations,
  listMessages,
  renameConversation,
  type CopilotConversation,
  type CopilotMessage,
} from "@/lib/copilot-api";

const PHASE_KEYS: Record<string, TranslationKey> = {
  context: "copilot.phase.context",
  summarizing: "copilot.phase.summarizing",
  model: "copilot.phase.model",
  tool: "copilot.phase.tool",
  queued: "copilot.phase.queued",
};

// Radix Select items cannot use an empty value; this sentinel maps back to
// "no project context" in onValueChange.
const NO_PROJECT_VALUE = "__no_project__";

/**
 * Copilot console — the primary conversational surface, laid out as a
 * ChatGPT/Claude-style two-column workbench: conversation history management
 * on the left (new / search / rename / delete, collapsible on desktop and a
 * Sheet on mobile), and a centered, width-capped message stream in the middle
 * with a runtime status bar, markdown rendering, collapsible tool steps,
 * approval cards, streaming tolerance, and a floating composer card. Send /
 * stop / edit / scroll-follow behavior lives in the shared
 * useCopilotChatController hook. All Copilot tool preferences live behind the
 * top-right gear button on the dedicated /copilot/settings page.
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [reviewTaskResults, setReviewTaskResults] = useState(false);
  const [repairFailedChecks, setRepairFailedChecks] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarSheetOpen, setSidebarSheetOpen] = useState(false);
  // null = follow the server-side preference / platform default; the status
  // bar back-fills this mirror whenever the effective preference changes.
  const [modelId, setModelId] = useState<string | null>(null);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const onModelChange = useCallback((next: string | null) => {
    setModelId(next);
  }, []);

  const requestedConversationRef = useRef<string | null>(null);
  requestedConversationRef.current = requestedConversationId;
  const previousRequestedRef = useRef(requestedConversationId);
  // The ?c= deep link is consumed once: after it has been applied — or the
  // user has picked a conversation manually — it must stop fighting the
  // sidebar for the selection.
  const deepLinkPendingRef = useRef(Boolean(requestedConversationId));

  // Conversation creation may race the project list; surface a single toast.
  const projectErrorToastRef = useRef(false);

  const readMessages = useCallback(async (id: string) => {
    if (controllerConversationIdRef.current !== id) return false;
    const serial = ++controllerMessageSerialRef.current;
    const epoch = controllerEpochRef.current;
    const current = () => serial === controllerMessageSerialRef.current && epoch === controllerEpochRef.current && controllerConversationIdRef.current === id;
    try {
      const { messages: next } = await listMessages(id);
      if (!current()) return false;
      setMessages(next);
      return true;
    } catch (error) {
      if (current()) throw error;
      return false;
    }
    // The controller refs are stable for the component lifetime; the eslint
    //-disable keeps this identity stable like the former inline refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshConversations = useCallback(async () => {
    const serial = ++listSerialRef.current;
    try {
      const { conversations: next } = await listConversations();
      if (serial !== listSerialRef.current) return;
      setConversations(next);
      if (!controllerConversationIdRef.current || deepLinkPendingRef.current) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    let cancelled = false;
    void listProjects()
      .then((result) => {
        if (cancelled) return;
        setProjects(result.projects);
      }).catch(() => {
        if (cancelled) return;
        setProjects([]);
        if (!projectErrorToastRef.current) {
          projectErrorToastRef.current = true;
          toast.error(t("copilot.projectLoadError"));
        }
      });
    return () => { cancelled = true; };
  }, [t]);

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

  const listSerialRef = useRef(0);

  const appendUserMessage = useCallback((text: string) => {
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
  }, [conversationId]);

  const autoTitleIfUntitled = useCallback(async (id: string, text: string) => {
    await renameConversation(id, text).catch(() => undefined);
  }, []);

  const reloadActiveConversation = useCallback(async (id: string) => {
    await Promise.all([readMessages(id), refreshConversations()]);
  }, [readMessages, refreshConversations]);

  const controller = useCopilotChatController({
    conversationId,
    projectId,
    modelId,
    reviewTaskResults,
    repairFailedChecks,
    savingPreferences,
    conversations,
    messages,
    active,
    startRun,
    startEditedRun,
    clearActive,
    markPending,
    reconcile,
    readMessages,
    refreshConversations,
    reloadActiveConversation,
    autoTitleIfUntitled,
    appendUserMessage,
  });
  const controllerEpochRef = controller.selectionEpochRef;
  const controllerMessageSerialRef = controller.messageSerialRef;
  const controllerConversationIdRef = controller.conversationIdRef;

  const selectConversation = useCallback(async (id: string) => {
    const epoch = controller.advanceSelectionEpoch();
    controller.conversationIdRef.current = id;
    setConversationId(id);
    // Shared with the floating robot panel so the next panel open resumes
    // the conversation the user was last working in here.
    writeLastCopilotConversation(id);
    setLoadError(null);
    controller.resetInteractionState();
    setProjectId("");
    // A user-initiated switch retires any pending deep link, so the URL can
    // no longer pull the selection back.
    deepLinkPendingRef.current = false;
    setMessages([]);
    setLoadingMessages(true);
    try {
      if (await readMessages(id)) controller.pinToBottom();
    } catch {
      if (controller.conversationIdRef.current === id) setLoadError(t("copilot.loadError"));
    } finally {
      if (controller.selectionEpochRef.current === epoch) setLoadingMessages(false);
    }
  }, [controller, readMessages, t]);

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

  const onRename = useCallback(async (id: string, title: string) => {
    try {
      await renameConversation(id, title);
      await refreshConversations();
    } catch {
      toast.error(t("copilot.renameFailed"));
    }
  }, [refreshConversations, t]);

  const onDelete = useCallback(async (id: string) => {
    try {
      await deleteConversation(id);
    } catch (error) {
      if (!(error instanceof GatewayApiError && error.status === 404)) {
        toast.error(t(error instanceof GatewayApiError && error.details?.code === "COPILOT_CONVERSATION_BUSY"
          ? "copilot.deleteBusy" : "copilot.deleteFailed"));
        return;
      }
    }
    listSerialRef.current++;
    setConversations(current => current.filter(item => item.id !== id));
    if (controller.conversationIdRef.current === id) {
      controller.advanceSelectionEpoch();
      controller.messageSerialRef.current++;
      controller.conversationIdRef.current = null;
      clearActive();
      setConversationId(null);
      setMessages([]);
      controller.resetInteractionState();
      writeLastCopilotConversation(null);
    }
    await refreshConversations();
  }, [clearActive, controller, refreshConversations, t]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const activeConversation = conversations.find((item) => item.id === conversationId);
  const isRunning = active && (active.status === "running" || active.status === "pending");
  const isBusy = Boolean(isRunning || active?.status === "awaiting_approval");
  const phaseLabel = isRunning ? t(PHASE_KEYS[active?.phase ?? "queued"] ?? "copilot.phase.default") : null;

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
              <Badge variant="outline" className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-xs text-emerald-600 dark:text-emerald-400">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                <span className="sr-only sm:not-sr-only">{t("copilot.running")}</span>
              </Badge>
            ) : null}
            <Link href="/copilot/tasks" aria-label={t("copilot.devTasks")} title={t("copilot.devTasks")} className="shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
              <ListTodo className="size-4 sm:hidden" />
              <span className="hidden sm:inline">{t("copilot.devTasks")}</span>
            </Link>
            <CopilotSettings />
          </div>
        </div>

        <CopilotStatusBar onModelChange={onModelChange} onSavingChange={setSavingPreferences} controlsDisabled={isBusy || controller.sending} />
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div ref={controller.scrollRef} onScroll={controller.onScroll} role="region" aria-label={t("copilot.conversations")} data-testid="copilot-message-history" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
              {loadError && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
                <p>{loadError}</p>
                <Button size="sm" variant="outline" onClick={() => void (conversationId ? selectConversation(conversationId) : refreshConversations())}>{t("copilot.retry")}</Button>
              </div>}
              {(loadingConversations || loadingMessages) && (
                <div role="status" data-testid="copilot-loading-skeleton" aria-label={t("common.loading")} className="space-y-3">
                  {[0, 1, 2].map((row) => (
                    <div key={row} className={row % 2 === 1 ? "flex flex-row-reverse gap-2.5" : "flex gap-2.5"}>
                      <div className="size-6 shrink-0 animate-pulse rounded-md bg-muted" />
                      <div className={row % 2 === 1 ? "flex w-4/5 flex-col items-end gap-1.5" : "flex-1 space-y-1.5"}>
                        <div className={`h-3 animate-pulse rounded bg-muted ${row === 0 ? "w-full" : row === 1 ? "w-3/5" : "w-4/5"}`} />
                        <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!loadError && !loadingConversations && !loadingMessages && messages.length === 0 && !active && (
                <CopilotWelcomeState onSuggestion={(text) => void controller.send(text)} />
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
                    isEditing={controller.editingMessageId === message.id}
                    editDraft={controller.editDraft}
                    editSubmitting={controller.editSubmitting || savingPreferences}
                    canEdit={!isBusy && !savingPreferences && !controller.sending && controller.editingMessageId === null}
                    onBeginEdit={controller.beginEditMessage}
                    onChangeDraft={controller.setEditDraft}
                    onSubmitEdit={() => void controller.submitEditMessage()}
                    onCancelEdit={controller.cancelEditMessage}
                  />
                );
              })}
              {(syncError || active?.error) && <p role="status" className="text-sm text-muted-foreground">{syncError || active?.error}</p>}
              {active?.status === "awaiting_approval" && (active.pendingAction
                ? <CopilotApproval key={active.pendingAction.id} action={active.pendingAction} onDecided={reconcile} />
                : <p role="status" className="text-sm text-muted-foreground">{t("copilot.awaitingApproval")}</p>)}
              {conversationId && <CopilotFollowupQueue active={isBusy} key={conversationId} conversationId={conversationId}
                {...(projectId ? { projectId } : {})} {...(modelId ? { modelId } : {})} />}
              {isRunning && phaseLabel ? (
                <Badge variant="secondary" className="w-fit gap-1.5 text-xs">
                  <span className="size-1.5 animate-pulse rounded-full bg-brand" />
                  {phaseLabel}
                </Badge>
              ) : null}
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
              {controller.sendFailed && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => void controller.send(undefined, true)}>
                    {t("copilot.retry")}
                  </Button>
                </div>
              )}
            </div>
          </div>
          {!controller.pinnedToBottom && (
            <Button
              variant="outline"
              size="icon"
              className="absolute bottom-3 right-3 z-10 size-8 rounded-full shadow"
              onClick={controller.scrollToBottom}
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
            <Select
              value={projectId || NO_PROJECT_VALUE}
              disabled={isBusy || controller.sending}
              onValueChange={(next) => setProjectId(next === NO_PROJECT_VALUE ? "" : next)}
            >
              <SelectTrigger
                id="copilot-project-context"
                aria-label={t("copilot.projectContext")}
                size="sm"
                className="min-w-0 max-w-60 flex-1 text-xs"
              >
                <SelectValue placeholder={t("copilot.noProject")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROJECT_VALUE}>{t("copilot.noProject")}</SelectItem>
                {projects.map(project => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <CopilotRunOptions
              conversationId={conversationId} modelId={modelId}
              disabled={isBusy || controller.sending}
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
              value={controller.input}
              onChange={(event) => controller.setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void controller.send();
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
                onClick={() => void controller.stopRun()}
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
                onClick={() => void controller.send()}
                disabled={controller.sending || savingPreferences || isBusy || !controller.input.trim() || !conversationId}
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
