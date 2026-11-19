"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUpRight, MessageSquare, PanelLeft, Plus, Target } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CopilotMessageStream } from "@/components/copilot/copilot-message-stream";
import { CopilotWelcomeState } from "@/components/copilot/copilot-empty-state";
import { CopilotSettings } from "@/components/copilot/copilot-settings";
import { CopilotStatusBadge, type CopilotStatusTone } from "@/components/copilot/copilot-status-badge";
import { CopilotActiveRunArea } from "@/components/copilot/CopilotActiveRunArea";
import { CopilotComposer } from "@/components/copilot/CopilotComposer";
import { ConversationSidebar } from "@/components/copilot/conversation-sidebar";
import { GoalCreateDialog } from "@/components/copilot/goal-create-dialog";
import { useGoalsCopy } from "@/components/copilot/goals-copy";
import { GatewayApiError, listProjects, type Project } from "@/lib/api";
import { readLastCopilotConversation, writeLastCopilotConversation } from "@/lib/copilot-conversation-storage";
import { useLanguage } from "@/hooks/use-language";
import { useCopilotRun } from "@/hooks/use-copilot";
import { useTerminalCommandProgress } from "@/hooks/use-terminal-command-progress";
import { useCopilotChatController } from "@/hooks/use-copilot-chat-controller";
import { useCopilotFollowups } from "@/hooks/use-copilot-followups";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  createConversation,
  deleteConversation,
  getGoal,
  listConversations,
  listGoals,
  listMessages,
  renameConversation,
  updateConversationProject,
  type CopilotConversation,
  type CopilotGoalListItem,
  type CopilotGoalStatus,
  type CopilotMessage,
} from "@/lib/copilot-api";

const GOAL_BADGE_TONE: Record<CopilotGoalStatus, CopilotStatusTone> = {
  active: "brand",
  paused: "warning",
  blocked: "destructive",
  completed: "success",
  cancelled: "muted",
};

/**
 * Copilot console — the primary conversational surface, laid out as a
 * ChatGPT/Claude-style full-bleed workbench: conversation history management
 * on the left (new / search / rename / delete, collapsible on desktop and a
 * Sheet on mobile), and a centered, width-capped message stream in the middle
 * with markdown rendering, collapsible tool steps, approval cards, streaming
 * tolerance, and an integrated composer card that also hosts the model/thinking
 * pickers. Send / stop / edit / scroll-follow behavior lives in the shared
 * useCopilotChatController hook.
 */
export function CopilotChat() {
  const { t } = useLanguage();
  const goalsCopy = useGoalsCopy();
  const searchParams = useSearchParams();
  // Deep link: /copilot?c=<conversationId> (e.g. "expand to full console" from
  // the robot chat panel) selects that conversation.
  const requestedConversationId = searchParams.get("c");

  const [conversations, setConversations] = useState<CopilotConversation[]>([]);
  const conversationsRef = useRef<CopilotConversation[]>([]);
  conversationsRef.current = conversations;
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const projectIdRef = useRef("");
  projectIdRef.current = projectId;
  const projectMutationRef = useRef(0);
  const [projectPendingCount, setProjectPendingCount] = useState(0);
  const projectSaving = projectPendingCount > 0;
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarSheetOpen, setSidebarSheetOpen] = useState(false);
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
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

  // Lazy conversation creation (empty state): creatingRef dedupes overlapping
  // send attempts so a double Enter cannot create two conversations, and
  // untitledRef marks the lazily created id so it is auto-titled at most once
  // (same contract as the floating robot panel).
  const creatingRef = useRef<Promise<string | null> | null>(null);
  const untitledRef = useRef<string | null>(null);

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
    const projectSerial = projectMutationRef.current;
    try {
      const { conversations: next } = await listConversations();
      if (serial !== listSerialRef.current) return;
      const currentId = controllerConversationIdRef.current;
      const merged = projectSerial === projectMutationRef.current ? next : next.map(item =>
        item.id === currentId ? { ...item, project_id: projectIdRef.current || null } : item);
      conversationsRef.current = merged;
      setConversations(merged);
      const current = merged.find(item => item.id === currentId);
      if (current && !deepLinkPendingRef.current && projectSerial === projectMutationRef.current) setProjectId(current.project_id ?? "");
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
  // search-param changes explicitly.
  useEffect(() => {
    if (previousRequestedRef.current === requestedConversationId) return;
    previousRequestedRef.current = requestedConversationId;
    deepLinkPendingRef.current = Boolean(requestedConversationId);
    if (!requestedConversationId) return;
    void refreshConversations();
  }, [requestedConversationId, refreshConversations]);

  const { active, startRun, startEditedRun, clearActive, markPending, reconcile, syncError } = useCopilotRun({
    conversationId,
    onSettled: async (id) => {
      await readMessages(id);
      await refreshConversations();
    },
    onReactiveUpdate: refreshConversations,
    onTitleUpdated: ({ conversationId, title }) => {
      setConversations((current) =>
        current.map((item) => (item.id === conversationId ? { ...item, title } : item))
      );
    },
  });

  const terminalProgress = useTerminalCommandProgress(conversationId);

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
    if (untitledRef.current === id) untitledRef.current = null;
    await renameConversation(id, text).catch(() => undefined);
  }, []);

  const reloadActiveConversation = useCallback(async (id: string) => {
    await Promise.all([readMessages(id), refreshConversations()]);
  }, [readMessages, refreshConversations]);

  const controller = useCopilotChatController({
    conversationId,
    projectId,
    modelId,
    savingPreferences: savingPreferences || projectSaving,
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

  const ensureConversation = useCallback((): Promise<string | null> => {
    if (controller.conversationIdRef.current) return Promise.resolve(controller.conversationIdRef.current);
    if (!creatingRef.current) {
      const epoch = controllerEpochRef.current;
      creatingRef.current = createConversation(undefined, projectId || undefined)
        .then(({ conversation }) => {
          if (epoch !== controllerEpochRef.current) return null;
          flushSync(() => {
            controller.conversationIdRef.current = conversation.id;
            untitledRef.current = conversation.id;
            setConversationId(conversation.id);
            writeLastCopilotConversation(conversation.id);
          });
          void refreshConversations();
          return conversation.id;
        })
        .catch(() => {
          if (epoch === controllerEpochRef.current) toast.error(t("copilot.loadError"));
          return null;
        })
        .finally(() => {
          creatingRef.current = null;
        });
    }
    return creatingRef.current;
  }, [controller, projectId, refreshConversations, t]);

  const selectConversation = useCallback(async (id: string) => {
    projectMutationRef.current++;
    const epoch = controller.advanceSelectionEpoch();
    controller.conversationIdRef.current = id;
    setConversationId(id);
    writeLastCopilotConversation(id);
    setLoadError(null);
    controller.resetInteractionState();
    setProjectId(conversationsRef.current.find(item => item.id === id)?.project_id ?? "");
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

  const changeProject = useCallback(async (next: string) => {
    const serial = ++projectMutationRef.current;
    const previous = projectId;
    setProjectId(next);
    if (!conversationId) return;
    setProjectPendingCount(count => count + 1);
    try {
      const { conversation } = await updateConversationProject(conversationId, next);
      if (serial !== projectMutationRef.current) return;
      projectMutationRef.current++;
      setProjectId(conversation.project_id ?? "");
      setConversations(current => current.map(item => item.id === conversation.id ? conversation : item));
    } catch {
      if (serial !== projectMutationRef.current) return;
      setProjectId(previous);
      toast.error(t("copilot.loadError"));
    } finally {
      setProjectPendingCount(count => Math.max(0, count - 1));
    }
  }, [conversationId, projectId, t]);

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

  const goalsQuery = useQuery({
    queryKey: ["copilot", "goals"],
    queryFn: () => listGoals(),
    staleTime: 15_000,
    retry: false,
  });

  const activeGoal = useMemo<CopilotGoalListItem | undefined>(() => {
    if (!conversationId) return undefined;
    return (goalsQuery.data?.goals ?? []).find(
      (goal) =>
        goal.conversationId === conversationId &&
        (goal.status === "active" || goal.status === "blocked" || goal.status === "paused"),
    );
  }, [conversationId, goalsQuery.data?.goals]);

  const blockedGoalDetailQuery = useQuery({
    queryKey: ["copilot", "goal", activeGoal?.id],
    queryFn: () => getGoal(activeGoal!.id),
    enabled: activeGoal?.status === "blocked",
    staleTime: 15_000,
    retry: false,
  });

  const activeGoalNeedsAnswer =
    activeGoal?.status === "blocked" &&
    (blockedGoalDetailQuery.data?.goal.blockedReason === "awaiting_user" ||
      (activeGoal as CopilotGoalListItem & { blockedReason?: string | null }).blockedReason === "awaiting_user");

  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const selectedProjectName = projectId ? projectsById.get(projectId) : undefined;

  const activeConversation = conversations.find((item) => item.id === conversationId);
  const isRunning = Boolean(active && (active.status === "running" || active.status === "pending"));
  const isBusy = Boolean(isRunning || active?.status === "awaiting_approval");
  const streamingShowsAvatar = messages[messages.length - 1]?.role !== "assistant";

  const followups = useCopilotFollowups({
    conversationId,
    ...(modelId ? { modelId } : {}),
    active: isBusy,
  });
  const enqueueRef = useRef(followups.enqueue);
  enqueueRef.current = followups.enqueue;
  const runningRef = useRef(isRunning);
  runningRef.current = isRunning;

  const submit = useCallback(async (textOverride?: string) => {
    if (projectSaving) return;
    if (creatingRef.current) {
      toast.info(t("copilot.creatingConversation"));
      return;
    }
    if (runningRef.current) {
      const text = inputRef.current.trim();
      if (!text || !conversationId) return;
      const clearSubmittedDraft = controller.captureDraft(text);
      if (await enqueueRef.current(text)) clearSubmittedDraft();
      return;
    }
    if (!conversationId) {
      const text = (textOverride ?? inputRef.current).trim();
      if (!text) return;
      const clearSubmittedDraft = controller.captureDraft(text);
      const id = await ensureConversation();
      if (!id) return;
      await controller.send(text, false, textOverride === undefined ? clearSubmittedDraft : undefined);
      return;
    }
    await controller.send(textOverride, false);
  }, [controller, conversationId, ensureConversation, projectSaving, t]);
  const inputRef = useRef(controller.input);
  inputRef.current = controller.input;

  const composerRef = useRef<HTMLTextAreaElement>(null);

  const goalStatusLabel = (status: CopilotGoalStatus) =>
    ({
      active: goalsCopy.statusActive,
      paused: goalsCopy.statusPaused,
      blocked: goalsCopy.statusBlocked,
      completed: goalsCopy.statusCompleted,
      cancelled: goalsCopy.statusCancelled,
    })[status];

  return (
    <div className="flex h-full min-h-0 w-full">
      <div
        data-testid="copilot-desktop-sidebar"
        aria-hidden={!sidebarOpen}
        inert={!sidebarOpen || undefined}
        className={cn(
          "hidden min-h-0 shrink-0 flex-col bg-card/40 transition-[width,opacity] duration-200 ease-out md:flex",
          sidebarOpen
            ? "w-64 border-r border-border/60 opacity-100"
            : "pointer-events-none w-0 overflow-hidden border-r-0 opacity-0",
        )}
      >
        <ConversationSidebar
          conversations={conversations}
          activeId={conversationId}
          creating={creating}
          projectsById={projectsById}
          onSelect={(id) => void selectConversation(id)}
          onCreate={() => void newConversation()}
          onRename={onRename}
          onDelete={onDelete}
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/50 pl-2 pr-3">
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
              aria-expanded={sidebarOpen}
              onClick={toggleSidebar}
            >
              <PanelLeft className="size-4" />
            </Button>
            <h1 className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold">
              <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
              {activeConversation?.title || t("copilot.untitled")}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Link
              href="/copilot/goals"
              aria-label={goalsCopy.title}
              title={goalsCopy.title}
              className="shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Target className="size-4 sm:hidden" />
              <span className="hidden sm:inline">{goalsCopy.title}</span>
            </Link>
            {conversationId ? (
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-xs"
                onClick={() => setGoalDialogOpen(true)}
                aria-label={goalsCopy.create}
                title={goalsCopy.create}
              >
                <Plus className="size-4 sm:hidden" />
                <span className="hidden sm:inline">{goalsCopy.create}</span>
              </Button>
            ) : null}
            <CopilotSettings />
          </div>
        </div>

        {activeGoal ? (
          <div
            data-testid="copilot-active-goal-banner"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 bg-muted/25 px-4 py-2 text-xs"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Target className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
              <span className="truncate font-medium text-foreground">{activeGoal.title}</span>
              <CopilotStatusBadge
                tone={GOAL_BADGE_TONE[activeGoal.status]}
                dot
                pulse={activeGoal.status === "active"}
              >
                {goalStatusLabel(activeGoal.status)}
              </CopilotStatusBadge>
              <span className="shrink-0 text-muted-foreground forgebadger-tabular-nums">
                {activeGoal.taskPasses}/{activeGoal.taskTotal}
              </span>
              {activeGoalNeedsAnswer ? (
                <CopilotStatusBadge tone="warning" dot pulse>
                  {t("copilot.activeGoalNeedsAnswer")}
                </CopilotStatusBadge>
              ) : null}
            </div>
            <Link
              href={`/copilot/goals/${encodeURIComponent(activeGoal.id)}`}
              className="inline-flex shrink-0 items-center gap-1 font-medium text-brand hover:underline"
            >
              <span>{t("copilot.activeGoalView")}</span>
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </Link>
          </div>
        ) : null}

        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={controller.scrollRef}
            onScroll={controller.onScroll}
            role="region"
            aria-label={t("copilot.conversations")}
            data-testid="copilot-message-history"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-6 pb-16 sm:px-6"
          >
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-5">
              {loadError && (
                <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
                  <p>{loadError}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void (conversationId ? selectConversation(conversationId) : refreshConversations())}
                  >
                    {t("copilot.retry")}
                  </Button>
                </div>
              )}
              {(loadingConversations || loadingMessages) && (
                <div
                  role="status"
                  data-testid="copilot-loading-skeleton"
                  aria-label={t("common.loading")}
                  className="space-y-3"
                >
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
                <CopilotWelcomeState
                  className="my-auto"
                  projectName={selectedProjectName}
                  onSuggestion={(text) => void submit(text)}
                />
              )}
              {messages.length > 0 && (
                <CopilotMessageStream
                  messages={messages}
                  isEditing={(message) => controller.editingMessageId === message.id}
                  editDraft={controller.editDraft}
                  editError={null}
                  editSubmitting={controller.editSubmitting || savingPreferences}
                  canEdit={!isBusy && !savingPreferences && !controller.sending && controller.editingMessageId === null}
                  onBeginEdit={controller.beginEditMessage}
                  onChangeDraft={controller.setEditDraft}
                  onSubmitEdit={() => void controller.submitEditMessage()}
                  onCancelEdit={controller.cancelEditMessage}
                />
              )}
              <CopilotActiveRunArea
                active={active}
                syncError={syncError}
                sendFailed={controller.sendFailed}
                streamingShowsAvatar={streamingShowsAvatar}
                terminalProgress={terminalProgress}
                onDecided={reconcile}
                onRetry={() => void controller.send(undefined, true)}
              />
            </div>
          </div>
          {!controller.pinnedToBottom && (
            <Button
              variant="outline"
              size="icon"
              className="absolute bottom-3 right-3 z-10 size-8 rounded-full shadow-raised"
              onClick={controller.scrollToBottom}
              aria-label={t("copilot.scrollDown")}
            >
              <ArrowDown className="size-4" />
            </Button>
          )}
        </div>

        <div className="relative shrink-0 px-3 pb-3 pt-1">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-full h-10 bg-gradient-to-t from-background via-background/80 to-transparent"
          />
          <div className="mx-auto w-full max-w-3xl">
            <CopilotComposer
              testId="copilot-composer"
              textareaRef={composerRef}
              input={controller.input}
              onInputChange={controller.setInput}
              onSubmit={() => void submit()}
              onStop={() => void controller.stopRun()}
              canStop={Boolean(active?.runId)}
              isRunning={isRunning}
              isBusy={isBusy}
              sendDisabled={
                controller.sending || savingPreferences || projectSaving || followups.enqueuing || !controller.input.trim()
              }
              projects={projects}
              projectId={projectId}
              conversationId={conversationId}
              onProjectChange={(next) => void changeProject(next)}
              onModelChange={onModelChange}
              onSavingChange={setSavingPreferences}
              toolbarDisabled={isBusy || controller.sending || projectSaving}
              followups={followups.items}
              onCancelFollowup={(id) => void followups.cancel(id)}
            />
          </div>
        </div>
      </div>

      <Sheet open={sidebarSheetOpen} onOpenChange={setSidebarSheetOpen}>
        <SheetContent
          side="left"
          className="w-80 border-r border-border/70 bg-sidebar/85 p-0 backdrop-blur-xl backdrop-saturate-150"
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            if (event.target instanceof HTMLElement && event.target.hasAttribute("data-conversation-rename")) {
              event.preventDefault();
            }
          }}
        >
          <SheetTitle className="sr-only">{t("copilot.conversations")}</SheetTitle>
          <ConversationSidebar
            conversations={conversations}
            activeId={conversationId}
            creating={creating}
            projectsById={projectsById}
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

      {conversationId ? (
        <GoalCreateDialog
          open={goalDialogOpen}
          conversationId={conversationId}
          {...(projectId ? { projectId } : {})}
          onOpenChange={setGoalDialogOpen}
        />
      ) : null}
    </div>
  );
}
