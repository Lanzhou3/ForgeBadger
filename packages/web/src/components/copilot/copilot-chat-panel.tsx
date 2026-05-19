"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Bot,
  Brain,
  FileText,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Send,
  Trash2,
  User,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  approveCopilotPendingAction,
  createCopilotConversation,
  createCopilotConversationMessage,
  deleteCopilotMemoryItem,
  deleteCopilotConversation,
  deleteCopilotMessage,
  GatewayApiError,
  getCopilotCapabilities,
  getCopilotRun,
  listCopilotMemoryEntries,
  listCopilotMemoryNotes,
  listCopilotConversationMessages,
  listCopilotConversations,
  rejectCopilotPendingAction,
  searchCopilotMemory,
  type CopilotConversation,
  type CopilotMemoryEntry,
  type CopilotMemoryItemType,
  type CopilotMemoryNote,
  type CopilotMemorySearchResult,
  type CopilotMessage,
  type CopilotPendingAction,
  type CopilotRun,
  type CopilotRunEvent,
  type CopilotSource,
} from "@/lib/api";
import {
  getCopilotErrorMessageKey,
  getCopilotEventResultSummary,
  getCopilotEventLabel,
  getCopilotEventLabelKey,
  getCopilotPendingActionLabel,
  getCopilotPendingActionLabelKey,
  getCopilotPendingActionSummary,
  getCopilotRunPollDelayMs,
  isCopilotRunLive,
  readCopilotTerminalSnapshotText,
  readCopilotMessageRunActivity,
  readCopilotRunErrorDetails,
  resolveCopilotRunFailureMessage,
  shouldKeepCopilotActiveRunState,
  shouldRefreshCopilotPanelForGatewayEvent,
  stripCopilotThinkingBlocks,
} from "@/lib/copilot";
import { OPENFORGE_GATEWAY_EVENT } from "@/lib/gateway-events";
import type { GatewayEvent } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/hooks/use-language";
import type { TranslationKey } from "@/lib/i18n";

interface ActiveRunState {
  run: CopilotRun;
  events: CopilotRunEvent[];
  pendingActions?: CopilotPendingAction[];
}

type CopilotSidebarView = "conversations" | "memory";

interface CopilotChatPanelProps {
  variant?: "page" | "drawer";
  initialPrompt?: string;
  initialSource?: CopilotSource;
  initialSourceRefId?: string;
  className?: string;
  onClose?: () => void;
}

export function CopilotChatPanel({
  variant = "page",
  initialPrompt = "",
  initialSource = "copilot",
  initialSourceRefId,
  className,
  onClose,
}: CopilotChatPanelProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const appliedInitialPromptRef = useRef(false);
  const assistantStreamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [draftConversationActive, setDraftConversationActive] = useState(false);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [localError, setLocalError] = useState("");
  const [activeRun, setActiveRun] = useState<ActiveRunState | null>(null);
  const [streamingAssistantText, setStreamingAssistantText] = useState("");
  const [optimisticUserMessage, setOptimisticUserMessage] = useState<CopilotMessage | null>(null);
  const [sidebarView, setSidebarView] = useState<CopilotSidebarView>("conversations");
  const [memorySearch, setMemorySearch] = useState("");
  const selectedConversationIdRef = useRef<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const optimisticUserMessageRef = useRef<CopilotMessage | null>(null);

  selectedConversationIdRef.current = selectedConversationId;
  activeRunIdRef.current = activeRun?.run.id ?? null;
  optimisticUserMessageRef.current = optimisticUserMessage;

  const compact = variant === "drawer";
  const memorySearchText = memorySearch.trim();
  const capabilitiesQuery = useQuery({
    queryKey: ["copilot-capabilities"],
    queryFn: getCopilotCapabilities,
    retry: false,
  });
  const conversationsQuery = useQuery({
    queryKey: ["copilot-conversations"],
    queryFn: () => listCopilotConversations(40),
    retry: false,
  });
  const conversations = conversationsQuery.data?.conversations ?? [];
  const memoryEntriesQuery = useQuery({
    queryKey: ["copilot-memory-entries", { limit: 20 }],
    queryFn: () => listCopilotMemoryEntries({ limit: 20 }),
    enabled: sidebarView === "memory" && !memorySearchText,
    retry: false,
  });
  const memoryNotesQuery = useQuery({
    queryKey: ["copilot-memory-notes", { limit: 20 }],
    queryFn: () => listCopilotMemoryNotes({ limit: 20 }),
    enabled: sidebarView === "memory" && !memorySearchText,
    retry: false,
  });
  const memorySearchQuery = useQuery({
    queryKey: ["copilot-memory-search", { query: memorySearchText, limit: 30 }],
    queryFn: () => searchCopilotMemory({ query: memorySearchText, includeNotes: true, limit: 30 }),
    enabled: sidebarView === "memory" && Boolean(memorySearchText),
    retry: false,
  });

  useEffect(() => {
    if (draftConversationActive) return;
    if (selectedConversationId && conversations.some((conversation) => conversation.id === selectedConversationId)) {
      return;
    }
    setSelectedConversationId(conversations[0]?.id ?? null);
  }, [conversations, draftConversationActive, selectedConversationId]);

  useEffect(() => {
    if (appliedInitialPromptRef.current || !initialPrompt.trim()) return;
    setPrompt((current) => (current.trim() ? current : initialPrompt));
    appliedInitialPromptRef.current = true;
  }, [initialPrompt]);

  const messagesQuery = useQuery({
    queryKey: ["copilot-conversation-messages", selectedConversationId],
    queryFn: () => listCopilotConversationMessages(selectedConversationId as string),
    enabled: Boolean(selectedConversationId),
    retry: false,
  });
  const messages = messagesQuery.data?.messages ?? [];
  const visibleMessages = optimisticUserMessage
    ? [...messages.filter((message) => message.id !== optimisticUserMessage.id), optimisticUserMessage]
    : messages;
  const messagesLoadFailed = messagesQuery.isError;
  const capabilitiesLoadFailed = capabilitiesQuery.isError;
  const providerReady = capabilitiesQuery.isSuccess && capabilitiesQuery.data.providerConfigured === true;
  const providerSetupBlocked = capabilitiesQuery.isSuccess && capabilitiesQuery.data.providerConfigured !== true;

  const createConversationMutation = useMutation({
    mutationFn: createCopilotConversation,
  });
  const sendMessageMutation = useMutation({
    mutationFn: async (text: string) => {
      let conversation: CopilotConversation | null =
        conversations.find((item) => item.id === selectedConversationId) ?? null;
      if (!conversation) {
        const created = await createConversationMutation.mutateAsync({
          title: titleFromPrompt(text),
          source: initialSource,
          ...(initialSourceRefId ? { sourceRefId: initialSourceRefId } : {}),
        });
        conversation = created.conversation;
        setSelectedConversationId(conversation.id);
      }
      const response = await createCopilotConversationMessage(conversation.id, {
        prompt: text,
        source: initialSource,
        async: true,
        ...(initialSourceRefId ? { sourceRefId: initialSourceRefId } : {}),
      });
      return { conversationId: conversation.id, response };
    },
    onMutate: (text) => {
      setStreamingAssistantText("");
      setOptimisticUserMessage({
        id: `optimistic-${Date.now()}`,
        conversationId: selectedConversationId ?? "pending",
        role: "user",
        content: text,
        createdAt: Date.now(),
      });
    },
    onSuccess: async ({ conversationId, response }) => {
      setSelectedConversationId(conversationId);
      setDraftConversationActive(false);
      setOptimisticUserMessage(null);
      setPrompt("");
      setLocalError("");
      applyActiveRunState({
        run: response.run,
        events: response.events,
        pendingActions: response.pendingActions,
      });
      renderConversationResponse(conversationId, response.messages);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["copilot-conversations"] }),
        queryClient.invalidateQueries({ queryKey: ["copilot-runs"] }),
      ]);
    },
    onError: async (error) => {
      setOptimisticUserMessage(null);
      setLocalError(resolveChatError(error, t));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["copilot-conversations"] }),
        queryClient.invalidateQueries({ queryKey: ["copilot-conversation-messages"] }),
      ]);
    },
  });
  const deleteConversationMutation = useMutation({
    mutationFn: deleteCopilotConversation,
    onSuccess: async () => {
      setSelectedConversationId(null);
      await queryClient.invalidateQueries({ queryKey: ["copilot-conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["copilot-conversation-messages"] });
    },
  });
  const deleteMemoryMutation = useMutation({
    mutationFn: ({ type, id }: { type: CopilotMemoryItemType; id: string }) => deleteCopilotMemoryItem(type, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["copilot-memory-entries"] });
      queryClient.invalidateQueries({ queryKey: ["copilot-memory-notes"] });
      queryClient.invalidateQueries({ queryKey: ["copilot-memory-search"] });
    },
  });
  const deleteMessageMutation = useMutation({
    mutationFn: deleteCopilotMessage,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["copilot-conversation-messages", selectedConversationId] });
    },
  });
  const decidePendingActionMutation = useMutation({
    mutationFn: async ({ action, decision }: { action: CopilotPendingAction; decision: "approve" | "reject" }) =>
      decision === "approve"
        ? approveCopilotPendingAction(action.runId, action.id)
        : rejectCopilotPendingAction(action.runId, action.id),
    onSuccess: async (data) => {
      const nextRun =
        data.run ?? ({ id: "", status: "completed", goal: "", source: "copilot" } as CopilotRun);
      setActiveRun((current) => {
        const nextState = {
          run: data.run ?? current?.run ?? nextRun,
          events: data.events ?? current?.events ?? [],
          pendingActions: data.pendingActions ?? [],
        };
        return shouldKeepCurrentActiveRun(current, nextState) ? current : nextState;
      });
      if (nextRun.status === "failed") {
        const failure = resolveCopilotRunFailureMessage(nextRun);
        setLocalError(failure?.messageKey ? t(failure.messageKey) : failure?.fallbackMessage ?? "Copilot request failed");
      } else {
        setLocalError("");
      }
      if (!isCopilotRunLive(nextRun.status)) setStreamingAssistantText("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["copilot-runs"] }),
        queryClient.invalidateQueries({ queryKey: ["copilot-conversations"] }),
        selectedConversationId
          ? queryClient.invalidateQueries({ queryKey: ["copilot-conversation-messages", selectedConversationId] })
          : Promise.resolve(),
      ]);
    },
    onError: (error) => setLocalError(resolveChatError(error, t)),
  });
  const sendDisabled = !providerReady || !prompt.trim() || sendMessageMutation.isPending;

  useEffect(() => {
    return () => {
      if (assistantStreamTimerRef.current) clearInterval(assistantStreamTimerRef.current);
    };
  }, []);

  const pendingActions = useMemo(
    () => (activeRun?.pendingActions ?? []).filter((action) => action.status === "pending"),
    [activeRun?.pendingActions]
  );
  const timelineEvents = useMemo(
    () => (activeRun?.events ?? []).filter((event) => event.type !== "assistant_message"),
    [activeRun?.events]
  );
  const activeRunHasActivity = timelineEvents.length > 0 || pendingActions.length > 0;
  const activeRunHasStream = Boolean(activeRun?.run.id && streamingAssistantText.trim());
  const activeRunAwaitingFirstEvent =
    Boolean(activeRun?.run.id && isCopilotRunLive(activeRun.run.status)) &&
    !activeRunHasActivity &&
    !activeRunHasStream &&
    !sendMessageMutation.isPending;
  const activityAssistantMessageId = useMemo(() => {
    if (!activeRun?.run.id || (!activeRunHasActivity && !activeRunHasStream)) return null;
    const matchingMessage = [...visibleMessages]
      .reverse()
      .find((message) => message.role === "assistant" && message.runId === activeRun.run.id);
    return matchingMessage?.id ?? createSyntheticActivityMessageId(activeRun.run.id);
  }, [activeRun?.run.id, activeRunHasActivity, activeRunHasStream, visibleMessages]);
  const visibleMessagesWithActivity = useMemo(() => {
    if (!activeRun?.run.id || !activityAssistantMessageId?.startsWith(SYNTHETIC_ACTIVITY_MESSAGE_PREFIX)) {
      return visibleMessages;
    }
    const activityMessage: CopilotMessage = {
      id: activityAssistantMessageId,
      conversationId: selectedConversationId ?? "pending",
      runId: activeRun.run.id,
      role: "assistant",
      content: streamingAssistantText,
      createdAt: activeRun.run.createdAt ?? null,
    };
    return [...visibleMessages, activityMessage];
  }, [
    activeRun?.run.createdAt,
    activeRun?.run.id,
    activityAssistantMessageId,
    selectedConversationId,
    streamingAssistantText,
    visibleMessages
  ]);
  const hasVisibleChatActivity =
    visibleMessagesWithActivity.length > 0 ||
    sendMessageMutation.isPending ||
    activeRunAwaitingFirstEvent;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [
    visibleMessagesWithActivity.length,
    activeRun?.events.length,
    pendingActions.length,
    sendMessageMutation.isPending,
    activeRunAwaitingFirstEvent,
    streamingAssistantText
  ]);

  useEffect(() => {
    if (!activeRun?.run.id || !isCopilotRunLive(activeRun.run.status)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pollAttempt = 0;
    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const schedulePoll = () => {
      clearTimer();
      if (stopped || document.visibilityState === "hidden") return;
      timer = setTimeout(pollRun, getCopilotRunPollDelayMs(pollAttempt));
    };
    const pollRun = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const data = await getCopilotRun(activeRun.run.id);
        if (stopped) return;
        applyActiveRunState({
          run: data.run,
          events: data.events,
          pendingActions: data.pendingActions,
        });
        if (isCopilotRunLive(data.run.status)) {
          pollAttempt += 1;
          schedulePoll();
          return;
        }
        if (data.run.status === "failed") {
          const failure = resolveCopilotRunFailureMessage(data.run);
          setLocalError(failure?.messageKey ? t(failure.messageKey) : failure?.fallbackMessage ?? "Copilot request failed");
        }
        if (!isCopilotRunLive(data.run.status)) {
          setOptimisticUserMessage(null);
          setStreamingAssistantText("");
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["copilot-runs"] }),
          queryClient.invalidateQueries({ queryKey: ["copilot-conversations"] }),
          selectedConversationId
            ? queryClient.invalidateQueries({ queryKey: ["copilot-conversation-messages", selectedConversationId] })
            : Promise.resolve(),
        ]);
      } catch (error) {
        if (!stopped) {
          setLocalError(resolveChatError(error, t));
          pollAttempt += 1;
          schedulePoll();
        }
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearTimer();
        return;
      }
      pollAttempt = 0;
      schedulePoll();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    schedulePoll();
    return () => {
      stopped = true;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [activeRun?.run.id, activeRun?.run.status, queryClient, selectedConversationId, t]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let stopped = false;
    const onGatewayEvent = async (event: Event) => {
      const detail = (event as CustomEvent<GatewayEvent>).detail;
      const eventType = typeof detail?.payload?.event_type === "string" ? detail.payload.event_type : null;
      const eventRunId = typeof detail?.payload?.run_id === "string" ? detail.payload.run_id : null;
      const eventConversationId =
        typeof detail?.payload?.conversation_id === "string" ? detail.payload.conversation_id : null;
      const currentActiveRunId = activeRunIdRef.current;
      const currentSelectedConversationId = selectedConversationIdRef.current;
      const currentOptimisticMessage = optimisticUserMessageRef.current;
      const matchesActiveRun = Boolean(currentActiveRunId && eventRunId === currentActiveRunId);
      const matchesSelectedConversation = Boolean(
        currentSelectedConversationId && eventConversationId === currentSelectedConversationId
      );
      const matchesPendingConversation = Boolean(
        !currentActiveRunId &&
        currentOptimisticMessage &&
        eventRunId &&
        eventConversationId
      );

      if (eventType === "assistant_delta" && (matchesActiveRun || matchesSelectedConversation || matchesPendingConversation)) {
        const delta = typeof detail?.payload?.delta_text === "string" ? detail.payload.delta_text : "";
        if (matchesPendingConversation && eventConversationId && eventRunId && currentOptimisticMessage) {
          setSelectedConversationId(eventConversationId);
          setOptimisticUserMessage((current) =>
            current && eventConversationId ? { ...current, conversationId: eventConversationId } : current
          );
          applyActiveRunState({
            run: {
              id: eventRunId,
              status: "running",
              goal: currentOptimisticMessage.content,
              source: "copilot",
            },
            events: [],
            pendingActions: [],
          });
        }
        if (delta) {
          setStreamingAssistantText((current) => current + delta);
        }
        return;
      }
      if (!shouldRefreshCopilotPanelForGatewayEvent({
        event: detail ?? {},
        activeRunId: currentActiveRunId,
        selectedConversationId: currentSelectedConversationId,
      })) {
        return;
      }
      const runId = currentActiveRunId ?? eventRunId;
      try {
        if (runId) {
          const data = await getCopilotRun(runId);
          if (stopped) return;
          applyActiveRunState({
            run: data.run,
            events: data.events,
            pendingActions: data.pendingActions,
          });
          if (data.run.status === "failed") {
            const failure = resolveCopilotRunFailureMessage(data.run);
            setLocalError(failure?.messageKey ? t(failure.messageKey) : failure?.fallbackMessage ?? "Copilot request failed");
          }
          if (!isCopilotRunLive(data.run.status)) {
            setOptimisticUserMessage(null);
            setStreamingAssistantText("");
          }
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["copilot-runs"] }),
          queryClient.invalidateQueries({ queryKey: ["copilot-conversations"] }),
          currentSelectedConversationId
            ? queryClient.invalidateQueries({ queryKey: ["copilot-conversation-messages", currentSelectedConversationId] })
            : Promise.resolve(),
        ]);
      } catch (error) {
        if (!stopped) setLocalError(resolveChatError(error, t));
      }
    };
    window.addEventListener(OPENFORGE_GATEWAY_EVENT, onGatewayEvent);
    return () => {
      stopped = true;
      window.removeEventListener(OPENFORGE_GATEWAY_EVENT, onGatewayEvent);
    };
  }, [queryClient, t]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitPrompt();
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submitPrompt();
  }

  function submitPrompt() {
    const text = prompt.trim();
    if (!text) return;
    if (sendMessageMutation.isPending) return;
    if (capabilitiesLoadFailed) {
      setLocalError(t("copilot.capabilitiesLoadFailed"));
      return;
    }
    if (!providerReady) {
      setLocalError(t("copilot.providerSetupRequired"));
      return;
    }
    sendMessageMutation.mutate(text);
  }

  function startNewConversation() {
    if (assistantStreamTimerRef.current) clearInterval(assistantStreamTimerRef.current);
    assistantStreamTimerRef.current = null;
    setDraftConversationActive(true);
    setSelectedConversationId(null);
    setPrompt("");
    setLocalError("");
    setActiveRun(null);
    setStreamingAssistantText("");
    setOptimisticUserMessage(null);
  }

  function selectConversation(id: string) {
    if (id === selectedConversationId) return;
    if (assistantStreamTimerRef.current) clearInterval(assistantStreamTimerRef.current);
    assistantStreamTimerRef.current = null;
    setDraftConversationActive(false);
    setOptimisticUserMessage(null);
    setActiveRun(null);
    setStreamingAssistantText("");
    setPrompt("");
    setSelectedConversationId(id);
  }

  function applyActiveRunState(nextState: ActiveRunState) {
    setActiveRun((current) => shouldKeepCurrentActiveRun(current, nextState) ? current : nextState);
  }

  function renderConversationResponse(conversationId: string, responseMessages: CopilotMessage[]) {
    const queryKey = ["copilot-conversation-messages", conversationId];
    const assistantMessage = [...responseMessages].reverse().find((message) => message.role === "assistant");
    setStreamingAssistantText("");
    if (!assistantMessage) {
      queryClient.setQueryData(queryKey, { messages: responseMessages });
      return;
    }

    const fullContent = assistantMessage.content;
    queryClient.setQueryData(queryKey, {
      messages: responseMessages.map((message) =>
        message.id === assistantMessage.id ? { ...message, content: "" } : message
      ),
    });
    if (assistantStreamTimerRef.current) clearInterval(assistantStreamTimerRef.current);
    let visibleLength = 0;
    const step = Math.max(1, Math.ceil(fullContent.length / 90));
    assistantStreamTimerRef.current = setInterval(() => {
      visibleLength = Math.min(fullContent.length, visibleLength + step);
      queryClient.setQueryData(queryKey, {
        messages: responseMessages.map((message) =>
          message.id === assistantMessage.id
            ? { ...message, content: fullContent.slice(0, visibleLength) }
            : message
        ),
      });
      if (visibleLength >= fullContent.length && assistantStreamTimerRef.current) {
        clearInterval(assistantStreamTimerRef.current);
        assistantStreamTimerRef.current = null;
      }
    }, 16);
  }

  return (
    <section className={cn("flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-background", className)}>
      {!compact && (
        <aside className="hidden w-72 shrink-0 border-r border-border bg-muted/20 md:flex md:flex-col">
          <PanelHeader view={sidebarView} onViewChange={setSidebarView} onNew={startNewConversation} />
          {sidebarView === "conversations" ? (
            <ConversationList
              conversations={conversations}
              selectedConversationId={selectedConversationId}
              loading={conversationsQuery.isLoading}
              onSelect={selectConversation}
              onDelete={(id) => deleteConversationMutation.mutate(id)}
            />
          ) : (
            <MemoryPanel
              entries={memoryEntriesQuery.data?.entries ?? []}
              notes={memoryNotesQuery.data?.notes ?? []}
              searchResults={memorySearchQuery.data?.results ?? []}
              search={memorySearch}
              searching={Boolean(memorySearchText)}
              loading={memoryEntriesQuery.isLoading || memoryNotesQuery.isLoading || memorySearchQuery.isLoading}
              error={memoryEntriesQuery.isError || memoryNotesQuery.isError || memorySearchQuery.isError}
              deletingId={deleteMemoryMutation.variables?.id ?? null}
              deleting={deleteMemoryMutation.isPending}
              onSearchChange={setMemorySearch}
              onDelete={(type, id) => deleteMemoryMutation.mutate({ type, id })}
            />
          )}
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Bot className="size-4 text-primary" aria-hidden="true" />
              <h1 className="truncate text-sm font-semibold text-foreground">{t("copilot.title")}</h1>
              {activeRun?.run.status && <Badge variant="outline">{activeRun.run.status}</Badge>}
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">{t("copilot.chatSubtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            {onClose && (
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                {t("common.close")}
              </Button>
            )}
          </div>
        </header>

        {compact && (
          <div className="border-b border-border px-3 py-2">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">{t("copilot.conversations")}</p>
              <Button type="button" variant="outline" size="sm" onClick={startNewConversation}>
                <Plus className="size-3.5" aria-hidden="true" />
                <span>{t("copilot.newConversation")}</span>
              </Button>
            </div>
            <ConversationList
              conversations={conversations.slice(0, 6)}
              selectedConversationId={selectedConversationId}
              loading={conversationsQuery.isLoading}
              onSelect={selectConversation}
              onDelete={(id) => deleteConversationMutation.mutate(id)}
              horizontal
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className={cn("mx-auto min-h-full", compact ? "max-w-none" : "max-w-4xl")}>
            {capabilitiesLoadFailed && (
              <div className="mb-4 flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p>{t("copilot.capabilitiesLoadFailed")}</p>
              </div>
            )}
            {providerSetupBlocked && (
              <div className="mb-4 flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <div>
                  <p>{t("copilot.providerSetupRequired")}</p>
                  <Link className="mt-1 inline-block text-xs underline" href="/models">
                    {t("copilot.configureProvider")}
                  </Link>
                </div>
              </div>
            )}
            {localError && (
              <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {localError}
              </div>
            )}
            {messagesLoadFailed && (
              <div className="mb-4 flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p>{resolveChatError(messagesQuery.error, t)}</p>
              </div>
            )}
            {messagesQuery.isLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                {t("common.loading")}
              </div>
            ) : messagesLoadFailed ? null : !hasVisibleChatActivity ? (
              <EmptyChat onPrompt={setPrompt} />
            ) : (
              <div className="space-y-5">
                {visibleMessagesWithActivity.map((message) => {
                  const showRunActivity = message.id === activityAssistantMessageId && activeRunHasActivity;
                  const persistedActivity = readCopilotMessageRunActivity<CopilotRunEvent, CopilotPendingAction>(message);
                  return (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      deleting={deleteMessageMutation.isPending}
                      canDelete={!message.id.startsWith(SYNTHETIC_ACTIVITY_MESSAGE_PREFIX)}
                      runEvents={showRunActivity ? timelineEvents : persistedActivity.events}
                      pendingActions={showRunActivity
                        ? pendingActions
                        : persistedActivity.pendingActions.filter((action) => action.status === "pending")}
                      deciding={decidePendingActionMutation.isPending}
                      onDelete={() => deleteMessageMutation.mutate(message.id)}
                      onDecide={(action, decision) => decidePendingActionMutation.mutate({ action, decision })}
                    />
                  );
                })}
                {sendMessageMutation.isPending && (
                  <TypingIndicator />
                )}
                {activeRunAwaitingFirstEvent && (
                  <TypingIndicator />
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </div>

        <form className="border-t border-border p-3" onSubmit={handleSubmit}>
          <div className={cn("mx-auto", compact ? "max-w-none" : "max-w-4xl")}>
            <div className="flex items-end gap-2 rounded-md border border-border bg-card p-2">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={handlePromptKeyDown}
                placeholder={t("copilot.chatPlaceholder")}
                className="min-h-14 flex-1 resize-none bg-transparent px-2 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                rows={compact ? 2 : 3}
              />
              <Button type="submit" size="sm" disabled={sendDisabled}>
                {sendMessageMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="size-4" aria-hidden="true" />
                )}
                <span className="sr-only">{t("copilot.send")}</span>
              </Button>
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}

const SYNTHETIC_ACTIVITY_MESSAGE_PREFIX = "active-run-activity-";

function createSyntheticActivityMessageId(runId: string): string {
  return `${SYNTHETIC_ACTIVITY_MESSAGE_PREFIX}${runId}`;
}

function AssistantActivity({
  events,
  pendingActions,
  deciding,
  onDecide,
  separated,
}: {
  events: CopilotRunEvent[];
  pendingActions: CopilotPendingAction[];
  deciding: boolean;
  onDecide: (action: CopilotPendingAction, decision: "approve" | "reject") => void;
  separated: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div className={cn("space-y-3", separated && "mt-3 border-t border-border/70 pt-3")}>
      {events.length > 0 && (
        <div className="space-y-2">
          {events.map((event) => (
            <RunEventRow key={event.id ?? `${event.sequence}-${event.type}`} event={event} />
          ))}
        </div>
      )}
      {pendingActions.length > 0 && (
        <div className="space-y-2 border-t border-border/70 pt-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">{t("copilot.pendingActions")}</p>
          {pendingActions.map((action) => (
            <PendingActionCard
              key={action.id}
              action={action}
              deciding={deciding}
              onDecide={onDecide}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RunEventRow({ event }: { event: CopilotRunEvent }) {
  const { t } = useLanguage();
  const key = getCopilotEventLabelKey(event.type);
  const label = key ? t(key) : getCopilotEventLabel(event.type);
  const detail = event.message ?? readToolName(event.payload) ?? "";
  const terminalText = readTerminalSnapshotText(event.payload);
  const memoryResults = readMemoryRecallResults(event.payload);
  const resultSummary = getCopilotEventResultSummary(event);
  return (
    <div className="flex min-w-0 items-start gap-2 text-sm">
      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/70" aria-hidden="true" />
      <div className="min-w-0">
        <div className="font-medium text-foreground">{label}</div>
        {detail && <div className="mt-0.5 break-words text-xs text-muted-foreground">{detail}</div>}
        {resultSummary && (
          <div className="mt-2 rounded-md border border-border bg-background/70 p-2 text-xs leading-5">
            <div className="break-words font-medium text-foreground">{resultSummary.detail}</div>
            {resultSummary.preview && (
              <div className="mt-0.5 break-words text-muted-foreground">{resultSummary.preview}</div>
            )}
          </div>
        )}
        {memoryResults.length > 0 && (
          <div className="mt-2 space-y-1 rounded-md border border-border bg-background/70 p-2">
            {memoryResults.map((memory) => (
              <div key={memory.id} className="min-w-0 text-xs leading-5">
                <div className="text-muted-foreground">{memory.type} / {memory.scope}</div>
                <div className="break-words text-foreground">{memory.snippet}</div>
              </div>
            ))}
          </div>
        )}
        {terminalText && (
          <pre className="mt-2 max-h-44 overflow-auto rounded-md border border-border bg-background/80 p-2 text-xs leading-5 text-foreground">
            {terminalText}
          </pre>
        )}
      </div>
    </div>
  );
}

function PendingActionCard({
  action,
  deciding,
  onDecide,
}: {
  action: CopilotPendingAction;
  deciding: boolean;
  onDecide: (action: CopilotPendingAction, decision: "approve" | "reject") => void;
}) {
  const { t } = useLanguage();
  const key = getCopilotPendingActionLabelKey(action.type);
  const label = key ? t(key) : getCopilotPendingActionLabel(action.type);
  const summary = getCopilotPendingActionSummary(action);
  return (
    <div className="space-y-3 rounded-md border border-border bg-background/70 p-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {summary?.detail && <div className="mt-1 break-words text-xs text-muted-foreground">{summary.detail}</div>}
        {summary?.preview && <div className="mt-1 break-words text-xs text-muted-foreground">{summary.preview}</div>}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={deciding}
          onClick={() => onDecide(action, "reject")}
        >
          {t("copilot.reject")}
        </Button>
        <Button type="button" size="sm" disabled={deciding} onClick={() => onDecide(action, "approve")}>
          {t("copilot.approve")}
        </Button>
      </div>
    </div>
  );
}

function TypingIndicator() {
  const { t } = useLanguage();
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {t("copilot.runStarting")}
    </div>
  );
}

function PanelHeader({
  view,
  onViewChange,
  onNew,
}: {
  view: CopilotSidebarView;
  onViewChange: (view: CopilotSidebarView) => void;
  onNew: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="space-y-3 border-b border-border px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="grid flex-1 grid-cols-2 rounded-md border border-border bg-background/60 p-0.5">
          <button
            type="button"
            className={cn(
              "flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition",
              view === "conversations"
                ? "bg-muted text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => onViewChange("conversations")}
          >
            <MessageSquare className="size-3.5" aria-hidden="true" />
            {t("copilot.conversations")}
          </button>
          <button
            type="button"
            className={cn(
              "flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition",
              view === "memory" ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => onViewChange("memory")}
          >
            <Brain className="size-3.5" aria-hidden="true" />
            {t("copilot.memory")}
          </button>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onNew}>
          <Plus className="size-4" aria-hidden="true" />
          <span className="sr-only">{t("copilot.newConversation")}</span>
        </Button>
      </div>
    </div>
  );
}

function MemoryPanel({
  entries,
  notes,
  searchResults,
  search,
  searching,
  loading,
  error,
  deleting,
  deletingId,
  onSearchChange,
  onDelete,
}: {
  entries: CopilotMemoryEntry[];
  notes: CopilotMemoryNote[];
  searchResults: CopilotMemorySearchResult[];
  search: string;
  searching: boolean;
  loading: boolean;
  error: boolean;
  deleting: boolean;
  deletingId: string | null;
  onSearchChange: (value: string) => void;
  onDelete: (type: CopilotMemoryItemType, id: string) => void;
}) {
  const { t } = useLanguage();
  const items = useMemo(
    () => searching ? searchResults.map(memorySearchResultToListItem) : [
      ...entries.map(memoryEntryToListItem),
      ...notes.map(memoryNoteToListItem),
    ],
    [entries, notes, searchResults, searching]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border p-3">
        <label className="sr-only" htmlFor="copilot-memory-search">{t("copilot.memorySearch")}</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id="copilot-memory-search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t("copilot.memorySearch")}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>
      {error ? (
        <p className="px-3 py-3 text-xs text-destructive">{t("copilot.memoryLoadFailed")}</p>
      ) : loading ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <div className="px-3 py-5 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{t("copilot.noMemory")}</p>
          <p className="mt-1 leading-5">{t("copilot.noMemoryDescription")}</p>
        </div>
      ) : (
        <div className="flex-1 space-y-2 overflow-y-auto p-2">
          {items.map((item) => (
            <MemoryListItem
              key={`${item.type}-${item.id}`}
              item={item}
              deleting={deleting && deletingId === item.id}
              onDelete={() => onDelete(item.type, item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface MemoryListItemView {
  id: string;
  type: CopilotMemoryItemType;
  label: string;
  scope: string;
  preview: string;
}

function MemoryListItem({
  item,
  deleting,
  onDelete,
}: {
  item: MemoryListItemView;
  deleting: boolean;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  return (
    <article className="group rounded-md border border-border bg-background/60 p-2.5">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            {item.type === "entry" ? (
              <Brain className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
            ) : (
              <FileText className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
            )}
            <span className="truncate text-xs font-medium text-foreground">{item.label}</span>
          </div>
          <Badge variant="outline" className="mt-1 max-w-full truncate text-[10px]">
            {item.scope}
          </Badge>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="size-7 shrink-0 p-0 opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
          disabled={deleting}
          onClick={onDelete}
        >
          {deleting ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="size-3.5" aria-hidden="true" />}
          <span className="sr-only">{t("copilot.deleteMemory")}</span>
        </Button>
      </div>
      <p className="mt-2 line-clamp-3 break-words text-xs leading-5 text-muted-foreground">{item.preview}</p>
    </article>
  );
}

function memoryEntryToListItem(entry: CopilotMemoryEntry): MemoryListItemView {
  return {
    id: entry.id,
    type: "entry",
    label: entry.kind || "memory",
    scope: formatMemoryScope(entry.scope, entry.projectId),
    preview: entry.redactedText,
  };
}

function memoryNoteToListItem(note: CopilotMemoryNote): MemoryListItemView {
  const scope = note.sessionId ? "session" : note.projectId ? "project" : "global";
  return {
    id: note.id,
    type: "note",
    label: "note",
    scope: formatMemoryScope(scope, note.projectId ?? note.sessionId ?? null),
    preview: note.redactedText,
  };
}

function memorySearchResultToListItem(result: CopilotMemorySearchResult): MemoryListItemView {
  return {
    id: result.id,
    type: result.type,
    label: result.type,
    scope: formatMemoryScope(result.scope, result.projectId),
    preview: result.snippet,
  };
}

function formatMemoryScope(scope: string, refId?: string | null): string {
  return refId ? `${scope}:${refId}` : scope;
}

function ConversationList({
  conversations,
  selectedConversationId,
  loading,
  horizontal = false,
  onSelect,
  onDelete,
}: {
  conversations: CopilotConversation[];
  selectedConversationId: string | null;
  loading: boolean;
  horizontal?: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useLanguage();
  if (loading) return <p className="px-3 py-2 text-xs text-muted-foreground">{t("common.loading")}</p>;
  if (conversations.length === 0) {
    return <p className="px-3 py-3 text-xs text-muted-foreground">{t("copilot.noConversations")}</p>;
  }
  return (
    <div className={cn("gap-2 p-2", horizontal ? "flex overflow-x-auto" : "flex flex-1 flex-col overflow-y-auto")}>
      {conversations.map((conversation) => (
        <div
          key={conversation.id}
          className={cn(
            "group flex min-w-0 items-center gap-1 rounded-md transition",
            horizontal ? "w-44 shrink-0" : "w-full",
            selectedConversationId === conversation.id
              ? "bg-primary/15 text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <button
            type="button"
            onClick={() => onSelect(conversation.id)}
            className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-sm"
          >
            <MessageSquare className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
          </button>
          <button
            type="button"
            className="mr-1 rounded p-1 opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
            onClick={() => onDelete(conversation.id)}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            <span className="sr-only">{t("copilot.deleteConversation")}</span>
          </button>
        </div>
      ))}
    </div>
  );
}

function EmptyChat({ onPrompt }: { onPrompt: (prompt: string) => void }) {
  const { t } = useLanguage();
  const starters = [
    t("copilot.starter.launchReadinessPrompt"),
    t("copilot.starter.releaseGatesPrompt"),
    t("copilot.starter.providerSetupPrompt"),
  ];
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="rounded-full border border-border bg-muted/30 p-3">
        <Bot className="size-6 text-primary" aria-hidden="true" />
      </div>
      <div>
        <h2 className="text-base font-semibold text-foreground">{t("copilot.emptyChatTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("copilot.emptyChatDescription")}</p>
      </div>
      <div className="grid w-full gap-2 sm:grid-cols-3">
        {starters.map((starter) => (
          <Button key={starter} type="button" variant="outline" className="h-auto whitespace-normal text-left" onClick={() => onPrompt(starter)}>
            {starter.slice(0, 42)}
          </Button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  deleting,
  canDelete,
  runEvents,
  pendingActions,
  deciding,
  onDelete,
  onDecide,
}: {
  message: CopilotMessage;
  deleting: boolean;
  canDelete: boolean;
  runEvents: CopilotRunEvent[];
  pendingActions: CopilotPendingAction[];
  deciding: boolean;
  onDelete: () => void;
  onDecide: (action: CopilotPendingAction, decision: "approve" | "reject") => void;
}) {
  const { t } = useLanguage();
  const assistant = message.role === "assistant";
  const content = assistant ? stripCopilotThinkingBlocks(message.content) : message.content;
  const hasActivity = assistant && (runEvents.length > 0 || pendingActions.length > 0);
  if (!content && !hasActivity) return null;
  return (
    <article className={cn("flex gap-3", assistant ? "justify-start" : "justify-end")}>
      {assistant && <BubbleAvatar icon={<Bot className="size-4" aria-hidden="true" />} />}
      <div
        className={cn(
          "group relative min-w-0 rounded-2xl px-4 py-3 shadow-sm",
          assistant
            ? "max-w-[min(760px,calc(100%-2.5rem))] border border-border/80 bg-card/75 text-foreground"
            : "max-w-[min(620px,calc(100%-2.5rem))] border border-primary/30 bg-primary/15 text-foreground"
        )}
      >
        {assistant ? (
          <>
            {content && <MarkdownContent content={content} />}
            {hasActivity && (
              <AssistantActivity
                events={runEvents}
                pendingActions={pendingActions}
                deciding={deciding}
                separated={Boolean(content)}
                onDecide={onDecide}
              />
            )}
          </>
        ) : (
          <div className="whitespace-pre-wrap break-words text-sm leading-6">{content}</div>
        )}
        {canDelete && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="absolute -bottom-3 right-2 h-7 w-7 rounded-full border border-border bg-background/95 p-0 opacity-0 shadow-sm transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
            disabled={deleting}
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            <span className="sr-only">{t("copilot.deleteMessage")}</span>
          </Button>
        )}
      </div>
      {!assistant && <BubbleAvatar icon={<User className="size-4" aria-hidden="true" />} />}
    </article>
  );
}

type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "orderedList"; items: string[] }
  | { type: "taskList"; items: Array<{ checked: boolean; text: string }> }
  | { type: "code"; code: string; language?: string }
  | { type: "heading"; level: 2 | 3 | 4; text: string }
  | { type: "quote"; text: string }
  | { type: "table"; header: string[]; rows: string[][] };

function MarkdownContent({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(content);
  return (
    <div className="space-y-3 text-sm leading-6">
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return (
            <pre key={index} className="overflow-x-auto rounded-md border border-border bg-background/80 p-3 text-xs">
              <code>{block.code}</code>
            </pre>
          );
        }
        if (block.type === "list") {
          return (
            <ul key={index} className="space-y-1 pl-4">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="list-disc break-words">
                  {renderInlineMarkdown(item, `${index}-${itemIndex}`)}
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === "orderedList") {
          return (
            <ol key={index} className="space-y-1 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="list-decimal break-words">
                  {renderInlineMarkdown(item, `${index}-${itemIndex}`)}
                </li>
              ))}
            </ol>
          );
        }
        if (block.type === "taskList") {
          return (
            <ul key={index} className="space-y-1">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex items-start gap-2 break-words">
                  <input
                    aria-label={item.text}
                    checked={item.checked}
                    className="mt-1 size-3.5 rounded border-border accent-primary"
                    disabled
                    readOnly
                    type="checkbox"
                  />
                  <span>{renderInlineMarkdown(item.text, `${index}-${itemIndex}`)}</span>
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === "heading") {
          const Heading = `h${block.level}` as "h2" | "h3" | "h4";
          return (
            <Heading key={index} className="text-sm font-semibold leading-6 text-foreground">
              {renderInlineMarkdown(block.text, String(index))}
            </Heading>
          );
        }
        if (block.type === "quote") {
          return (
            <blockquote key={index} className="border-l-2 border-primary/50 pl-3 text-muted-foreground">
              {renderInlineMarkdown(block.text, String(index))}
            </blockquote>
          );
        }
        if (block.type === "table") {
          return (
            <div key={index} className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-80 border-collapse text-left text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    {block.header.map((cell, cellIndex) => (
                      <th key={cellIndex} className="border-b border-border px-3 py-2 font-medium">
                        {renderInlineMarkdown(cell, `${index}-head-${cellIndex}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-t border-border/70">
                      {block.header.map((_, cellIndex) => (
                        <td key={cellIndex} className="px-3 py-2 align-top text-foreground">
                          {renderInlineMarkdown(row[cellIndex] ?? "", `${index}-${rowIndex}-${cellIndex}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return (
          <p key={index} className="whitespace-pre-wrap break-words">
            {renderInlineMarkdown(block.text, String(index))}
          </p>
        );
      })}
    </div>
  );
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/gu, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim() || undefined;
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", code: codeLines.join("\n"), language });
      continue;
    }

    if (isMarkdownTableStart(lines, index)) {
      const tableLines: string[] = [];
      while (index < lines.length && isMarkdownTableRow(lines[index] ?? "")) {
        tableLines.push(lines[index] ?? "");
        index += 1;
      }
      const [headerLine, , ...bodyLines] = tableLines;
      blocks.push({
        type: "table",
        header: splitMarkdownTableRow(headerLine ?? ""),
        rows: bodyLines.map(splitMarkdownTableRow),
      });
      continue;
    }

    if (/^#{2,4}\s+/u.test(trimmed)) {
      const level = Math.min(Math.max((trimmed.match(/^#+/u)?.[0].length ?? 2), 2), 4) as 2 | 3 | 4;
      blocks.push({ type: "heading", level, text: trimmed.replace(/^#{2,4}\s+/u, "") });
      index += 1;
      continue;
    }

    if (/^>\s?/u.test(trimmed)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/u.test((lines[index] ?? "").trim())) {
        quoteLines.push((lines[index] ?? "").trim().replace(/^>\s?/u, ""));
        index += 1;
      }
      blocks.push({ type: "quote", text: quoteLines.join("\n") });
      continue;
    }

    if (/^[-*]\s+\[[ xX]\]\s+/u.test(trimmed)) {
      const items: Array<{ checked: boolean; text: string }> = [];
      while (index < lines.length && /^[-*]\s+\[[ xX]\]\s+/u.test((lines[index] ?? "").trim())) {
        const item = (lines[index] ?? "").trim();
        const checked = /^[-*]\s+\[[xX]\]/u.test(item);
        items.push({
          checked,
          text: item.replace(/^[-*]\s+\[[ xX]\]\s+/u, ""),
        });
        index += 1;
      }
      blocks.push({ type: "taskList", items });
      continue;
    }

    if (/^\d+\.\s+/u.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/u.test((lines[index] ?? "").trim())) {
        items.push((lines[index] ?? "").trim().replace(/^\d+\.\s+/u, ""));
        index += 1;
      }
      blocks.push({ type: "orderedList", items });
      continue;
    }

    if (/^[-*]\s+/u.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/u.test((lines[index] ?? "").trim())) {
        items.push((lines[index] ?? "").trim().replace(/^[-*]\s+/u, ""));
        index += 1;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      (lines[index] ?? "").trim() &&
      !(lines[index] ?? "").trim().startsWith("```") &&
      !isMarkdownTableStart(lines, index) &&
      !/^#{2,4}\s+/u.test((lines[index] ?? "").trim()) &&
      !/^>\s?/u.test((lines[index] ?? "").trim()) &&
      !/^[-*]\s+\[[ xX]\]\s+/u.test((lines[index] ?? "").trim()) &&
      !/^\d+\.\s+/u.test((lines[index] ?? "").trim()) &&
      !/^[-*]\s+/u.test((lines[index] ?? "").trim())
    ) {
      paragraphLines.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join("\n") });
  }

  return blocks;
}

function isMarkdownTableStart(lines: string[], index: number): boolean {
  return isMarkdownTableRow(lines[index] ?? "") && isMarkdownTableSeparator(lines[index + 1] ?? "");
}

function isMarkdownTableRow(line: string): boolean {
  return line.trim().startsWith("|") && line.trim().includes("|", 1);
}

function isMarkdownTableSeparator(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/u.test(line.trim());
}

function splitMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/gu;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 text-[0.85em] text-foreground">
          {token.slice(1, -1)}
        </code>
      );
    } else {
      nodes.push(<strong key={key} className="font-semibold text-foreground">{token.slice(2, -2)}</strong>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function BubbleAvatar({ icon }: { icon: ReactNode }) {
  return (
    <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
      {icon}
    </div>
  );
}

function readToolName(payload: Record<string, unknown> | undefined): string {
  const output = payload?.output;
  if (!output || typeof output !== "object" || Array.isArray(output)) return "";
  const type = (output as { type?: unknown }).type;
  return typeof type === "string" ? type : "";
}

function readTerminalSnapshotText(payload: Record<string, unknown> | undefined): string {
  return readCopilotTerminalSnapshotText(payload).trim();
}

interface MemoryRecallSummary {
  id: string;
  type: string;
  scope: string;
  snippet: string;
}

function readMemoryRecallResults(payload: Record<string, unknown> | undefined): MemoryRecallSummary[] {
  const results = payload?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const id = record.id;
      const type = record.type;
      const scope = record.projectId ? `${record.scope}:${record.projectId}` : record.scope;
      const snippet = record.snippet;
      if (
        typeof id !== "string" ||
        typeof type !== "string" ||
        typeof scope !== "string" ||
        typeof snippet !== "string" ||
        snippet.trim().length === 0
      ) {
        return null;
      }
      return {
        id,
        type,
        scope,
        snippet: snippet.trim(),
      };
    })
    .filter((item): item is MemoryRecallSummary => Boolean(item))
    .slice(0, 5);
}

function titleFromPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= 42) return normalized || "Copilot";
  return `${normalized.slice(0, 42)}...`;
}

function shouldKeepCurrentActiveRun(current: ActiveRunState | null, next: ActiveRunState): boolean {
  return shouldKeepCopilotActiveRunState(current, next);
}

function resolveChatError(error: unknown, t: (key: TranslationKey) => string): string {
  if (error instanceof GatewayApiError) {
    const details = readCopilotRunErrorDetails<CopilotRun>(error);
    const resolved = details?.run ? resolveCopilotRunFailureMessage(details.run) : null;
    if (resolved?.messageKey) return t(resolved.messageKey);
    if (resolved?.fallbackMessage) return resolved.fallbackMessage;
    const key = getCopilotErrorMessageKey(String(error.details?.code ?? ""));
    if (key) return t(key);
    return error.message;
  }
  return error instanceof Error ? error.message : "Copilot request failed";
}
