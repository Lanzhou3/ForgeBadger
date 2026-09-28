"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowDown, ArrowUp, Maximize2, Square, SquarePen, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageRow,
  StreamingMessage,
  ThinkingSection,
  indexToolResults,
} from "@/components/copilot/copilot-message-primitives";
import { CopilotWelcomeState } from "@/components/copilot/copilot-empty-state";
import { CopilotRunOptions } from "@/components/copilot/CopilotRunOptions";
import { CopilotFollowupQueue } from "@/components/copilot/CopilotFollowupQueue";
import { CopilotStatusBar } from "@/components/copilot/copilot-runtime-panel";
import { CopilotApproval } from "@/components/copilot/CopilotApproval";
import { useLanguage } from "@/hooks/use-language";
import { useCopilotRun } from "@/hooks/use-copilot";
import { useCopilotChatController } from "@/hooks/use-copilot-chat-controller";
import { GatewayApiError, listProjects, type Project } from "@/lib/api";
import {
  createConversation,
  listMessages,
  renameConversation,
  type CopilotMessage,
} from "@/lib/copilot-api";
import { cn } from "@/lib/utils";
import { LAST_COPILOT_CONVERSATION_KEY, readLastCopilotConversation, writeLastCopilotConversation } from "@/lib/copilot-conversation-storage";

const AUTO_TITLE_MAX_CHARS = 24;
// Shared with the full /copilot console — keep the same storage key so both
// surfaces resume the conversation the user last worked in.
export const ROBOT_CONVERSATION_STORAGE_KEY = LAST_COPILOT_CONVERSATION_KEY;

// Radix Select items cannot use an empty value; this sentinel maps back to
// "no project context" in onValueChange (same pattern as the console).
const NO_PROJECT_VALUE = "__no_project__";

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
 *
 * Send / stop / edit / scroll-follow behavior lives in the shared
 * useCopilotChatController hook (same as the /copilot console); this surface
 * only owns conversation restore/lazy creation plus the parity capability
 * row (project context, run options) and the model/thinking pickers from
 * CopilotStatusBar.
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [modelId, setModelId] = useState<string | null>(null);
  const [reviewTaskResults, setReviewTaskResults] = useState(false);
  const [repairFailedChecks, setRepairFailedChecks] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

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
    // The controller refs are stable for the component lifetime; keeping this
    // dependency-free mirrors the console's readMessages identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { active, startRun, startEditedRun, clearActive, markPending, reconcile, syncError } = useCopilotRun({
    conversationId,
    onSettled: async (id) => {
      await readMessages(id);
    },
  });

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

  // No conversation list on this surface: the controller only needs these as
  // inert callbacks (the untitled check resolves through untitledRef instead).
  const refreshConversations = useCallback(async () => undefined, []);

  const controller = useCopilotChatController({
    conversationId,
    projectId,
    modelId,
    reviewTaskResults,
    repairFailedChecks,
    savingPreferences,
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

  // Restore the previous conversation on mount; a stale id (deleted on the
  // server) is dropped so the panel falls back to a fresh draft. Runs once:
  // the controller ref objects are stable for the component lifetime, while
  // the controller return object is not. Runs that finished while the panel
  // was hidden (expanded to the console, tab switched, …) are covered by
  // useCopilotRun's focus/online/reconnect reconciliation, which reloads the
  // durable messages via onSettled.
  useEffect(() => {
    const stored = readLastCopilotConversation();
    if (!stored) return;
    let disposed = false;
    const epoch = controllerEpochRef.current;
    const serial = ++controllerMessageSerialRef.current;
    setRestoring(true);
    controller.conversationIdRef.current = stored;
    setConversationId(stored);
    listMessages(stored)
      .then(({ messages: next }) => {
        if (!disposed && serial === controllerMessageSerialRef.current && epoch === controllerEpochRef.current && controller.conversationIdRef.current === stored) {
          setMessages(next);
          setLoadError(null);
        }
      })
      .catch((error: unknown) => {
        if (disposed || epoch !== controllerEpochRef.current || controller.conversationIdRef.current !== stored) return;
        if (error instanceof GatewayApiError && error.status === 404) {
          controller.conversationIdRef.current = null;
          writeLastCopilotConversation(null);
          setConversationId(null);
          setMessages([]);
          clearActive();
        } else setLoadError(t("copilot.loadError"));
      })
      .finally(() => { if (!disposed && epoch === controllerEpochRef.current) setRestoring(false); });
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Lazy creation: the conversation only exists on the server once the user
  // actually sends something. flushSync forces the id into the controller's
  // options before controller.send reads them (React would otherwise batch
  // the render until after the send guard has already bailed on a null id).
  const ensureConversation = useCallback((): Promise<string | null> => {
    if (controller.conversationIdRef.current) return Promise.resolve(controller.conversationIdRef.current);
    if (!creatingRef.current) {
      const epoch = controllerEpochRef.current;
      creatingRef.current = createConversation()
        .then(({ conversation }) => {
          if (epoch !== controllerEpochRef.current) return null;
          flushSync(() => {
            controller.conversationIdRef.current = conversation.id;
            untitledRef.current = conversation.id;
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
  }, [controller, t]);

  const send = useCallback(async (textOverride?: string, retry = false) => {
    if (retry) {
      await controller.send(undefined, true);
      return;
    }
    // Lazy creation in flight: the controller's sending guard is not armed
    // yet, so a double Enter here would double-submit (duplicate message +
    // run). Drop the duplicate; the first submit owns the in-flight creation.
    if (creatingRef.current) return;
    const text = (textOverride ?? controller.input).trim();
    if (!text) return;
    const id = await ensureConversation();
    if (!id) return;
    await controller.send(textOverride, false);
  }, [controller, ensureConversation]);

  const newChat = useCallback(() => {
    controller.advanceSelectionEpoch();
    controller.messageSerialRef.current++;
    controller.conversationIdRef.current = null;
    untitledRef.current = null;
    clearActive();
    setConversationId(null);
    setMessages([]);
    setLoadError(null);
    setProjectId("");
    controller.resetInteractionState();
    controller.setInput("");
    writeLastCopilotConversation(null);
  }, [clearActive, controller]);

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

      {/* Model / thinking-effort pickers, shared with the console so both
          surfaces read and write the same server-side preferences. */}
      <CopilotStatusBar onModelChange={setModelId} onSavingChange={setSavingPreferences} controlsDisabled={isBusy || controller.sending} />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={controller.scrollRef}
          onScroll={controller.onScroll}
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
          {showEmpty && <CopilotWelcomeState compact onSuggestion={(text) => void send(text)} />}
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
          {active?.thinking ? <ThinkingSection text={active.thinking} live={isRunning === true} /> : null}
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
              <Button variant="outline" size="sm" onClick={() => void send(undefined, true)}>
                {t("copilot.retry")}
              </Button>
            </div>
          )}
        </div>
        {!controller.pinnedToBottom && (
          <Button
            variant="outline"
            size="icon"
            className="absolute bottom-3 right-3 z-10 size-7 rounded-full shadow"
            onClick={controller.scrollToBottom}
            aria-label={t("copilot.scrollDown")}
          >
            <ArrowDown className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Floating composer: no docked bottom bar. The upward gradient fades
          messages out beneath the elevated input card (Linear/v0 assistant
          pattern), and the card lifts on hover / glows on focus. The compact
          context row above it mirrors the console's project-context picker
          and run options without consuming transcript height. */}
      <div className="relative shrink-0 px-2.5 pb-2.5 pt-1">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Select
            value={projectId || NO_PROJECT_VALUE}
            disabled={isBusy || controller.sending}
            onValueChange={(next) => setProjectId(next === NO_PROJECT_VALUE ? "" : next)}
          >
            <SelectTrigger
              aria-label={t("copilot.projectContext")}
              size="sm"
              className="h-7 min-w-0 max-w-40 flex-1 px-2 text-xs"
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
          data-testid="robot-chat-composer"
          className="flex items-end gap-1.5 rounded-xl border border-border/70 bg-card/90 px-2 py-1.5 shadow-lg shadow-black/20 backdrop-blur-md transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-border hover:shadow-xl hover:shadow-black/30 focus-within:border-brand/60 focus-within:shadow-xl focus-within:shadow-black/30 focus-within:ring-1 focus-within:ring-brand/30"
        >
          <Textarea
            ref={inputRef}
            value={controller.input}
            onChange={(event) => controller.setInput(event.target.value)}
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
              onClick={() => void controller.stopRun()}
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
              disabled={controller.sending || savingPreferences || isBusy || !controller.input.trim()}
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
