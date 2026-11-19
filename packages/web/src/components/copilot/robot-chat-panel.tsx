"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  ArrowDown,
  ArrowLeftRight,
  Bot,
  History,
  Maximize2,
  MessageSquare,
  SquarePen,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CopilotMessageStream } from "@/components/copilot/copilot-message-stream";
import { CopilotWelcomeState } from "@/components/copilot/copilot-empty-state";
import { CopilotActiveRunArea } from "@/components/copilot/CopilotActiveRunArea";
import { CopilotComposer } from "@/components/copilot/CopilotComposer";
import { formatConversationTime } from "@/components/copilot/conversation-sidebar";
import { useLanguage } from "@/hooks/use-language";
import { useCopilotRun } from "@/hooks/use-copilot";
import { useTerminalCommandProgress } from "@/hooks/use-terminal-command-progress";
import { useCopilotChatController } from "@/hooks/use-copilot-chat-controller";
import { useCopilotFollowups } from "@/hooks/use-copilot-followups";
import { copilotPhaseLabel } from "@/lib/copilot-phase";
import { GatewayApiError, listProjects, type Project } from "@/lib/api";
import {
  createConversation,
  getConversation,
  listConversations,
  listMessages,
  renameConversation,
  updateConversationProject,
  type CopilotConversation,
  type CopilotMessage,
} from "@/lib/copilot-api";
import { cn } from "@/lib/utils";
import type { RobotCorner } from "@/lib/pixel-robot";
import { toast } from "@/lib/toast";
import { LAST_COPILOT_CONVERSATION_KEY, readLastCopilotConversation, writeLastCopilotConversation } from "@/lib/copilot-conversation-storage";

const AUTO_TITLE_MAX_CHARS = 24;
const RECENT_CONVERSATIONS_LIMIT = 8;
// Shared with the full /copilot console — keep the same storage key so both
// surfaces resume the conversation the user last worked in.
export const ROBOT_CONVERSATION_STORAGE_KEY = LAST_COPILOT_CONVERSATION_KEY;

// Desktop anchor per robot corner. The panel keeps the same 128px (md:*-32)
// gap off the shared edge as the classic bottom-right placement: the robot
// itself spans 20px corner margin + 88px sprite = 108px, leaving a 20px
// breathing gap.
const PANEL_DESKTOP_ANCHOR_BY_CORNER: Record<RobotCorner, string> = {
  "bottom-right": "md:bottom-32 md:right-4 md:top-auto",
  "bottom-left": "md:bottom-32 md:left-4 md:top-auto",
  "top-right": "md:bottom-auto md:right-4 md:top-32",
  "top-left": "md:bottom-auto md:left-4 md:top-32",
};

const PANEL_ORIGIN_BY_CORNER: Record<RobotCorner, string> = {
  "bottom-right": "origin-bottom-right",
  "bottom-left": "origin-bottom-left",
  "top-right": "origin-top-right",
  "top-left": "origin-top-left",
};

interface RobotChatPanelProps {
  onClose: () => void;
  /** Expand to the full Copilot console, carrying the current conversation. */
  onExpandFull: (conversationId: string | null) => void;
  /**
   * Viewport corner the robot is pinned to. The panel anchors to the same
   * corner — above the robot for bottom corners, below it for top corners —
   * so it opens beside the pet instead of always bottom-right.
   */
  corner?: RobotCorner;
  /** Explicit project context (e.g. "Ask Copilot" triggered on a project). */
  explicitProjectId?: string;
  /** Passive project context inferred from the current route. */
  routeProjectId?: string;
  /** Legacy alias for passive default project context. */
  defaultProjectId?: string;
  /** Incremented to force a clean new-chat draft while open or opening. */
  newChatNonce?: number;
}

/**
 * Floating quick-chat panel anchored beside the robot (Linear/v0-style
 * side assistant). Desktop: a 416x580 card (expandable to 540px wide) pinned
 * to the robot's corner; small screens: a near-fullscreen bottom sheet.
 * Conversations are created lazily on the first message and the active
 * conversation id persists in localStorage unless an explicit cross-project
 * trigger requests a distinct project context.
 */
export function RobotChatPanel({
  onClose,
  onExpandFull,
  corner = "bottom-right",
  explicitProjectId,
  routeProjectId,
  defaultProjectId,
  newChatNonce = 0,
}: RobotChatPanelProps) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    inputRef.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  const passiveProjectId = routeProjectId ?? defaultProjectId;
  const initialProjectId = explicitProjectId ?? passiveProjectId ?? "";

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(initialProjectId);
  const projectMutationRef = useRef(0);
  const [projectPendingCount, setProjectPendingCount] = useState(0);
  const projectSaving = projectPendingCount > 0;
  const [modelId, setModelId] = useState<string | null>(null);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wide, setWide] = useState(false);

  // Recent-conversations popover state (lazy loaded on open).
  const [historyOpen, setHistoryOpen] = useState(false);
  const [recentConversations, setRecentConversations] = useState<CopilotConversation[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  // Track the active conversation's persisted project_id so cross-project
  // triggers while the panel is already open know whether to branch a clean draft.
  const currentConversationProjectRef = useRef<string | null>(null);
  const explicitProjectIdRef = useRef(explicitProjectId);
  explicitProjectIdRef.current = explicitProjectId;

  // Conversation ids created lazily by this panel and not yet auto-titled;
  // the controller's autoTitleIfUntitled renames at most once per id.
  const untitledRef = useRef<string | null>(null);
  // In-flight lazy creation, shared between overlapping send attempts so a
  // double Enter cannot create two conversations.
  const creatingRef = useRef<Promise<string | null> | null>(null);

  const readMessages = useCallback(async (id: string) => {
    if (controllerConversationIdRef.current !== id) return false;
    const serial = ++controllerMessageSerialRef.current;
    const epoch = controllerEpochRef.current;
    const current = () => serial === controllerMessageSerialRef.current && epoch === controllerEpochRef.current && controllerConversationIdRef.current === id;
    try {
      const { messages: next } = await listMessages(id);
      if (!current()) return false;
      setMessages(next);
      setLoadError(null);
      return true;
    } catch (error) {
      if (current()) throw error;
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { active, startRun, startEditedRun, clearActive, markPending, reconcile, syncError } = useCopilotRun({
    conversationId,
    onSettled: async (id) => {
      await readMessages(id);
    },
  });

  const terminalProgress = useTerminalCommandProgress(conversationId);

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
    if (untitledRef.current !== id) return;
    untitledRef.current = null;
    await renameConversation(id, text.slice(0, AUTO_TITLE_MAX_CHARS)).catch(() => undefined);
  }, []);

  const reloadActiveConversation = useCallback(async (id: string) => {
    await readMessages(id);
  }, [readMessages]);

  const refreshConversations = useCallback(async () => undefined, []);

  const controller = useCopilotChatController({
    conversationId,
    projectId,
    modelId,
    savingPreferences: savingPreferences || projectSaving,
    conversations: [],
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

  const startFreshDraft = useCallback(
    (boundProjectId: string, clearStorage: boolean) => {
      projectMutationRef.current++;
      controller.advanceSelectionEpoch();
      controller.messageSerialRef.current++;
      controller.conversationIdRef.current = null;
      untitledRef.current = null;
      currentConversationProjectRef.current = null;
      clearActive();
      setConversationId(null);
      setMessages([]);
      setLoadError(null);
      setRestoring(false);
      setProjectId(boundProjectId);
      controller.resetInteractionState();
      controller.setInput("");
      if (clearStorage) writeLastCopilotConversation(null);
    },
    [clearActive, controller],
  );

  // Restore the previous conversation on mount unless a fresh draft was
  // explicitly requested or an explicit project context differs from the
  // stored conversation's project_id.
  useEffect(() => {
    if (newChatNonce > 0) return;
    const stored = readLastCopilotConversation();
    if (!stored) return;
    let disposed = false;
    const epoch = controllerEpochRef.current;
    const serial = ++controllerMessageSerialRef.current;
    const projectSerial = projectMutationRef.current;
    setRestoring(true);
    controller.conversationIdRef.current = stored;
    setConversationId(stored);
    Promise.all([listMessages(stored), getConversation(stored)])
      .then(([{ messages: next }, { conversation }]) => {
        if (
          disposed ||
          serial !== controllerMessageSerialRef.current ||
          projectSerial !== projectMutationRef.current ||
          epoch !== controllerEpochRef.current ||
          controller.conversationIdRef.current !== stored
        ) {
          return;
        }
        const targetExplicit = explicitProjectIdRef.current;
        if (targetExplicit && conversation.project_id !== targetExplicit) {
          // Cross-project context fix: do not let an old conversation from a
          // different project hijack an explicit "Ask Copilot" launch.
          startFreshDraft(targetExplicit, false);
          return;
        }
        currentConversationProjectRef.current = conversation.project_id ?? null;
        setMessages(next);
        setProjectId(targetExplicit ?? conversation.project_id ?? passiveProjectId ?? "");
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (disposed || epoch !== controllerEpochRef.current || controller.conversationIdRef.current !== stored) return;
        if (error instanceof GatewayApiError && error.status === 404) {
          controller.conversationIdRef.current = null;
          currentConversationProjectRef.current = null;
          writeLastCopilotConversation(null);
          setConversationId(null);
          setMessages([]);
          clearActive();
        } else {
          setLoadError(t("copilot.loadError"));
        }
      })
      .finally(() => {
        if (!disposed && epoch === controllerEpochRef.current) setRestoring(false);
      });
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to explicit project changes while the panel is already mounted.
  const previousExplicitRef = useRef(explicitProjectId);
  useEffect(() => {
    if (previousExplicitRef.current === explicitProjectId) return;
    previousExplicitRef.current = explicitProjectId;
    if (!explicitProjectId) return;
    if (!controller.conversationIdRef.current) {
      setProjectId(explicitProjectId);
      return;
    }
    if (currentConversationProjectRef.current !== explicitProjectId) {
      startFreshDraft(explicitProjectId, false);
    }
  }, [explicitProjectId, controller.conversationIdRef, startFreshDraft]);

  // React to external "new chat" trigger while mounted.
  const previousNewChatNonceRef = useRef(newChatNonce);
  useEffect(() => {
    if (previousNewChatNonceRef.current === newChatNonce) return;
    previousNewChatNonceRef.current = newChatNonce;
    if (newChatNonce > 0) {
      startFreshDraft(explicitProjectId ?? "", false);
    }
  }, [newChatNonce, explicitProjectId, startFreshDraft]);

  useEffect(() => {
    let cancelled = false;
    void listProjects()
      .then((result) => {
        if (!cancelled) setProjects(result.projects);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });
    return () => { cancelled = true; };
  }, []);

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
            currentConversationProjectRef.current = conversation.project_id ?? (projectId || null);
            setConversationId(conversation.id);
            writeLastCopilotConversation(conversation.id);
          });
          return conversation.id;
        })
        .catch(() => {
          if (epoch === controllerEpochRef.current) setLoadError(t("copilot.loadError"));
          return null;
        })
        .finally(() => {
          creatingRef.current = null;
        });
    }
    return creatingRef.current;
  }, [controller, projectId, t]);

  const changeProject = useCallback(async (next: string) => {
    const serial = ++projectMutationRef.current;
    const previous = projectId;
    setProjectId(next);
    if (!conversationId) return;
    setProjectPendingCount(count => count + 1);
    try {
      const { conversation } = await updateConversationProject(conversationId, next);
      if (serial === projectMutationRef.current) {
        projectMutationRef.current++;
        currentConversationProjectRef.current = conversation.project_id ?? null;
        setProjectId(conversation.project_id ?? "");
      }
    } catch {
      if (serial !== projectMutationRef.current) return;
      setProjectId(previous);
      setLoadError(t("copilot.loadError"));
    } finally {
      setProjectPendingCount(count => Math.max(0, count - 1));
    }
  }, [conversationId, projectId, t]);

  const send = useCallback(async (textOverride?: string, retry = false) => {
    if (projectSaving) return;
    if (retry) {
      await controller.send(undefined, true);
      return;
    }
    if (creatingRef.current) {
      toast.info(t("copilot.creatingConversation"));
      return;
    }
    const text = (textOverride ?? controller.input).trim();
    if (!text) return;
    if (runningRef.current) {
      if (!conversationId) { toast.info(t("copilot.creatingConversation")); return; }
      const clearSubmittedDraft = controller.captureDraft(text);
      const queued = await enqueueRef.current(text);
      if (queued) clearSubmittedDraft();
      return;
    }
    const id = await ensureConversation();
    if (!id) return;
    await controller.send(textOverride, false);
  }, [controller, ensureConversation, conversationId, projectSaving, t]);

  const newChat = useCallback(() => {
    startFreshDraft("", true);
  }, [startFreshDraft]);

  const switchConversation = useCallback(
    async (conv: CopilotConversation) => {
      setHistoryOpen(false);
      projectMutationRef.current++;
      const epoch = controller.advanceSelectionEpoch();
      controller.conversationIdRef.current = conv.id;
      untitledRef.current = null;
      currentConversationProjectRef.current = conv.project_id ?? null;
      clearActive();
      setConversationId(conv.id);
      writeLastCopilotConversation(conv.id);
      setLoadError(null);
      controller.resetInteractionState();
      setProjectId(conv.project_id ?? "");
      setMessages([]);
      setRestoring(true);
      try {
        if (await readMessages(conv.id)) controller.pinToBottom();
      } catch {
        if (controller.conversationIdRef.current === conv.id) setLoadError(t("copilot.loadError"));
      } finally {
        if (controller.selectionEpochRef.current === epoch) setRestoring(false);
      }
    },
    [clearActive, controller, readMessages, t],
  );

  const openHistoryPopover = useCallback(
    (nextOpen: boolean) => {
      setHistoryOpen(nextOpen);
      if (!nextOpen) return;
      setLoadingRecent(true);
      void listConversations()
        .then((result) => {
          setRecentConversations(result.conversations.slice(0, RECENT_CONVERSATIONS_LIMIT));
        })
        .catch(() => {
          setRecentConversations([]);
        })
        .finally(() => {
          setLoadingRecent(false);
        });
    },
    [],
  );

  const isRunning = Boolean(active && (active.status === "running" || active.status === "pending"));
  const isBusy = Boolean(isRunning || active?.status === "awaiting_approval");

  const followups = useCopilotFollowups({
    conversationId,
    ...(modelId ? { modelId } : {}),
    active: isBusy,
  });
  const enqueueRef = useRef(followups.enqueue);
  enqueueRef.current = followups.enqueue;
  const runningRef = useRef(isRunning);
  runningRef.current = isRunning;

  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const selectedProjectName = projectId ? projectsById.get(projectId) : undefined;

  const showEmpty = !loadError && !restoring && messages.length === 0 && !active;
  const streamingShowsAvatar = messages[messages.length - 1]?.role !== "assistant";

  return (
    <div
      role="dialog"
      aria-label={t("nav.copilot")}
      data-testid="robot-chat-panel"
      onKeyDown={event => {
        if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); onClose(); }
      }}
      className={cn(
        "forgebadger-panel-pop fixed inset-x-2 bottom-2 top-3 z-50 flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-overlay transition-[width] duration-150 md:inset-x-auto md:h-[580px] md:max-h-[calc(100dvh-9rem)]",
        wide ? "md:w-[540px]" : "md:w-[416px]",
        PANEL_DESKTOP_ANCHOR_BY_CORNER[corner],
        PANEL_ORIGIN_BY_CORNER[corner],
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="relative flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/10">
            <Bot className="size-4 text-brand" aria-hidden="true" />
            <span
              className={cn(
                "absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-card",
                isRunning ? "forgebadger-pulse-dot bg-brand" : "bg-success"
              )}
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[13px] font-semibold">{t("nav.copilot")}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {isRunning ? t(copilotPhaseLabel(active?.phase)) : t("copilot.robotStatusReady")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <Popover open={historyOpen} onOpenChange={openHistoryPopover}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                aria-label={t("copilot.recentConversations")}
                title={t("copilot.recentConversations")}
              >
                <History className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-1.5">
              <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                {t("copilot.recentConversations")}
              </p>
              {loadingRecent ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">{t("common.loading")}</p>
              ) : recentConversations.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">{t("copilot.noConversations")}</p>
              ) : (
                <div className="max-h-64 space-y-0.5 overflow-y-auto">
                  {recentConversations.map((conv) => {
                    const isCurrent = conv.id === conversationId;
                    return (
                      <button
                        key={conv.id}
                        type="button"
                        onClick={() => void switchConversation(conv)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                          isCurrent ? "bg-brand/10 font-medium text-foreground" : "text-foreground/85 hover:bg-muted",
                        )}
                      >
                        <MessageSquare className={cn("size-3.5 shrink-0", isCurrent ? "text-brand" : "text-muted-foreground")} />
                        <span className="min-w-0 flex-1 truncate">{conv.title || t("copilot.untitled")}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground forgebadger-tabular-nums">
                          {formatConversationTime(conv.updated_at)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon"
            className="hidden size-7 text-muted-foreground hover:text-foreground md:inline-flex"
            aria-label={wide ? t("copilot.panelCompact") : t("copilot.panelWider")}
            title={wide ? t("copilot.panelCompact") : t("copilot.panelWider")}
            onClick={() => setWide((current) => !current)}
          >
            <ArrowLeftRight className="size-3.5" />
          </Button>
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
          ref={controller.scrollRef}
          onScroll={controller.onScroll}
          data-testid="robot-chat-scroll"
          className="flex-1 space-y-4 overflow-y-auto px-3.5 pt-4 pb-14"
        >
          {loadError && <p className="text-sm text-destructive">{loadError}</p>}
          {!loadError && restoring && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-brand" />
              {t("common.loading")}
            </p>
          )}
          {showEmpty && (
            <CopilotWelcomeState
              compact
              projectName={selectedProjectName}
              onSuggestion={(text) => void send(text)}
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
            onRetry={() => void send(undefined, true)}
          />
        </div>
        {!controller.pinnedToBottom && (
          <Button
            variant="outline"
            size="icon"
            className="absolute bottom-3 right-3 z-10 size-7 rounded-full shadow-raised"
            onClick={controller.scrollToBottom}
            aria-label={t("copilot.scrollDown")}
          >
            <ArrowDown className="size-3.5" />
          </Button>
        )}
      </div>

      <div className="relative shrink-0 px-3 pb-3">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-full h-10 bg-gradient-to-t from-card via-card/80 to-transparent"
        />
        <CopilotComposer
          testId="robot-chat-composer"
          compact
          textareaRef={inputRef}
          input={controller.input}
          onInputChange={controller.setInput}
          onSubmit={() => void send()}
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
          onModelChange={setModelId}
          onSavingChange={setSavingPreferences}
          toolbarDisabled={isBusy || controller.sending || projectSaving}
          followups={followups.items}
          onCancelFollowup={(id) => void followups.cancel(id)}
        />
      </div>
    </div>
  );
}
