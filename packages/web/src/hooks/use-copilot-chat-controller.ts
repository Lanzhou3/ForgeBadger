"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { useLanguage } from "@/hooks/use-language";
import { useCopilotRun, type ActiveCopilotRun } from "@/hooks/use-copilot";
import { cancelRun, type CopilotConversation, type CopilotMessage } from "@/lib/copilot-api";

export interface CopilotChatControllerOptions {
  conversationId: string | null;
  projectId: string;
  modelId: string | null;
  reviewTaskResults: boolean;
  repairFailedChecks: boolean;
  savingPreferences: boolean;
  conversations: CopilotConversation[];
  /** Current transcript; the follow-bottom effect reacts to it. */
  messages: CopilotMessage[];
  /** From useCopilotRun. */
  active: ActiveCopilotRun | null;
  startRun: ReturnType<typeof useCopilotRun>["startRun"];
  startEditedRun: ReturnType<typeof useCopilotRun>["startEditedRun"];
  clearActive: () => void;
  markPending: (conversationId: string) => void;
  reconcile: () => Promise<void>;
  /** Conversation-management callbacks owned by the surface. */
  readMessages: (id: string) => Promise<boolean>;
  refreshConversations: () => Promise<unknown>;
  reloadActiveConversation: (id: string) => Promise<void>;
  /** Auto-title an untitled conversation after its first message. */
  autoTitleIfUntitled: (conversationId: string, text: string) => Promise<void>;
  /** Optimistically append a local user message to the transcript. */
  appendUserMessage: (text: string) => void;
}

export interface CopilotChatController {
  input: string;
  setInput: (value: string) => void;
  sending: boolean;
  /** True when the last submission failed; keeps the inline retry action alive. */
  sendFailed: boolean;
  send: (textOverride?: string, retry?: boolean) => Promise<void>;
  stopRun: () => Promise<void>;
  editingMessageId: string | null;
  editDraft: string;
  editSubmitting: boolean;
  setEditDraft: (value: string) => void;
  beginEditMessage: (message: CopilotMessage) => void;
  cancelEditMessage: () => void;
  submitEditMessage: () => Promise<void>;
  /** Reset send/edit transient state; called when the selection changes. */
  resetInteractionState: () => void;
  /** Bump the selection epoch; returns the new epoch for async guards. */
  advanceSelectionEpoch: () => number;
  // Shared out-of-order guards, exposed for the surface's conversation
  // management (readMessages/selectConversation).
  selectionEpochRef: React.RefObject<number>;
  messageSerialRef: React.RefObject<number>;
  conversationIdRef: React.RefObject<string | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  pinnedToBottom: boolean;
  onScroll: () => void;
  scrollToBottom: () => void;
  /** Re-arm follow mode without forcing an immediate scroll. */
  pinToBottom: () => void;
}

const AUTO_TITLE_MAX_CHARS = 24;

/**
 * Chat send/stop/edit/scroll controller shared by conversational Copilot
 * surfaces. It owns the optimistic send (including retry with a stable client
 * request id), the epoch/serial guards that drop late responses after a
 * conversation switch, and the follow-the-stream scroll behavior. The owning
 * surface keeps conversation management (list/select/rename/delete) and
 * provides the callbacks above; behavior matches the former inline
 * implementation in copilot-chat.tsx.
 */
export function useCopilotChatController(options: CopilotChatControllerOptions): CopilotChatController {
  const { t } = useLanguage();
  const [input, setInputState] = useState("");
  const [sending, setSending] = useState(false);
  // Synchronous mirror of `sending` for the send guard. React state updates
  // are batched asynchronously, so two rapid Enter presses can both observe
  // `sending === false` before the first setSending(true) commits. The ref
  // flips synchronously inside send() to close that window.
  const sendingRef = useRef(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  // Synchronous mirror of `editSubmitting` for the edit guard (same rationale
  // as sendingRef).
  const editSubmittingRef = useRef(false);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastSentRef = useRef<{ conversationId: string; text: string; projectId?: string; modelId?: string; clientRequestId: string; reviewTaskResults?: boolean; repairFailedChecks?: boolean } | null>(null);
  const lastEditRef = useRef<{ signature: string; clientRequestId: string; reviewTaskResults?: boolean; repairFailedChecks?: boolean } | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const selectionEpochRef = useRef(0);
  const messageSerialRef = useRef(0);
  const inputRef = useRef(input);
  inputRef.current = input;

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const { messages, active } = options;

  const setInput = useCallback((value: string) => setInputState(value), []);

  const resetInteractionState = useCallback(() => {
    sendingRef.current = false;
    editSubmittingRef.current = false;
    setSending(false);
    setSendFailed(false);
    setEditingMessageId(null);
    setEditDraft("");
    setEditSubmitting(false);
    lastSentRef.current = null;
    lastEditRef.current = null;
  }, []);

  const advanceSelectionEpoch = useCallback(() => ++selectionEpochRef.current, []);

  const send = useCallback(async (textOverride?: string, retry = false) => {
    const opts = optionsRef.current;
    const prior = retry ? lastSentRef.current : null;
    const text = (prior?.text ?? textOverride ?? inputRef.current).trim();
    const id = opts.conversationId;
    if (!text || !id || sendingRef.current || opts.savingPreferences || (opts.active && ["pending", "running", "awaiting_approval"].includes(opts.active.status))) return;
    if (retry && (!prior || prior.conversationId !== id)) return;
    const epoch = selectionEpochRef.current;
    messageSerialRef.current++;
    const request = prior ?? { conversationId: id, text, ...(opts.projectId ? { projectId: opts.projectId } : {}), ...(opts.modelId ? { modelId: opts.modelId } : {}), clientRequestId: crypto.randomUUID(), reviewTaskResults: opts.reviewTaskResults, repairFailedChecks: opts.repairFailedChecks };
    lastSentRef.current = request;
    if (!retry) opts.appendUserMessage(text);
    if (!textOverride) setInputState("");
    sendingRef.current = true;
    setSending(true);
    setSendFailed(false);
    opts.clearActive();
    // Show the "thinking" pulse immediately; the first run event can lag the
    // POST while the Gateway starts the model turn.
    opts.markPending(id);
    try {
      await opts.startRun(id, text, request.modelId, { ...(request.projectId ? { projectId: request.projectId } : {}), clientRequestId: request.clientRequestId, ...(request.repairFailedChecks ? { repairFailedChecks: true } : {}), ...(request.reviewTaskResults ? { reviewTaskResults: true } : {}) });
      if (epoch !== selectionEpochRef.current) return;
      const wasUntitled = !opts.conversations.find((item) => item.id === id)?.title;
      if (wasUntitled) await opts.autoTitleIfUntitled(id, text.slice(0, AUTO_TITLE_MAX_CHARS));
      await opts.reloadActiveConversation(id).catch(() => {
        if (selectionEpochRef.current === epoch) toast.error(t("copilot.loadError"));
      });
    } catch {
      if (selectionEpochRef.current === epoch) {
        opts.clearActive();
        setSendFailed(true);
        toast.error(t("copilot.sendError"));
      }
    } finally {
      if (selectionEpochRef.current === epoch) {
        sendingRef.current = false;
        setSending(false);
      }
    }
  }, [t]);

  const stopRun = useCallback(async () => {
    const opts = optionsRef.current;
    if (!opts.active?.runId) return;
    const epoch = selectionEpochRef.current;
    try {
      await cancelRun(opts.active.runId);
      await opts.reconcile();
      if (opts.active.conversationId) await opts.reloadActiveConversation(opts.active.conversationId);
    } catch {
      if (epoch === selectionEpochRef.current) toast.error(t("copilot.cancelFailed"));
    }
  }, [t]);

  const beginEditMessage = useCallback((message: CopilotMessage) => {
    setEditingMessageId(message.id);
    setEditDraft(message.content);
  }, []);

  const cancelEditMessage = useCallback(() => {
    setEditingMessageId(null);
    setEditDraft("");
  }, []);

  const submitEditMessage = useCallback(async () => {
    const opts = optionsRef.current;
    const id = opts.conversationId;
    const targetId = editingMessageId;
    const content = editDraft.trim();
    if (!id || !targetId || !content || editSubmittingRef.current || opts.savingPreferences || sendingRef.current) return;
    const epoch = selectionEpochRef.current;
    messageSerialRef.current++;
    const signature = JSON.stringify([id, targetId, content, opts.projectId, opts.modelId]);
    const request = lastEditRef.current?.signature === signature ? lastEditRef.current : { signature, clientRequestId: crypto.randomUUID(), reviewTaskResults: opts.reviewTaskResults, repairFailedChecks: opts.repairFailedChecks };
    lastEditRef.current = request;
    editSubmittingRef.current = true;
    setEditSubmitting(true);
    opts.clearActive();
    try {
      await opts.startEditedRun(id, targetId, content, { clientRequestId: request.clientRequestId, ...(opts.projectId ? { projectId: opts.projectId } : {}), ...(opts.modelId ? { modelId: opts.modelId } : {}), ...(request.repairFailedChecks ? { repairFailedChecks: true } : {}), ...(request.reviewTaskResults ? { reviewTaskResults: true } : {}) });
      if (epoch !== selectionEpochRef.current) return;
      setEditingMessageId(null);
      setEditDraft("");
      lastEditRef.current = null;
      await opts.reloadActiveConversation(id).catch(() => {
        if (epoch === selectionEpochRef.current) toast.error(t("copilot.loadError"));
      });
    } catch {
      if (epoch === selectionEpochRef.current) toast.error(t("copilot.editFailed"));
    } finally {
      if (epoch === selectionEpochRef.current) {
        editSubmittingRef.current = false;
        setEditSubmitting(false);
      }
    }
  }, [editingMessageId, editDraft, t]);

  const onScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    setPinnedToBottom(distanceFromBottom < 80);
  }, []);

  // Follow the stream while the user is pinned to the bottom; scrolling up
  // pauses follow mode so they can read undisturbed.
  useEffect(() => {
    if (pinnedToBottom) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [messages, active?.text, pinnedToBottom]);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    setPinnedToBottom(true);
  }, []);

  const pinToBottom = useCallback(() => setPinnedToBottom(true), []);

  return {
    input,
    setInput,
    sending,
    sendFailed,
    send,
    stopRun,
    editingMessageId,
    editDraft,
    editSubmitting,
    setEditDraft,
    beginEditMessage,
    cancelEditMessage,
    submitEditMessage,
    resetInteractionState,
    advanceSelectionEpoch,
    selectionEpochRef,
    messageSerialRef,
    conversationIdRef,
    scrollRef,
    pinnedToBottom,
    onScroll,
    scrollToBottom,
    pinToBottom,
  };
}
