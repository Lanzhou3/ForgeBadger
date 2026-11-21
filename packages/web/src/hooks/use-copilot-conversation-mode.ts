"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { parseEnterPlanMode } from "@/components/copilot/CopilotModeProposalCard";
import { useLanguage } from "@/hooks/use-language";
import { updateConversationMode, type CopilotChatMode, type CopilotConversation, type CopilotMessage } from "@/lib/copilot-api";
import { toast } from "@/lib/toast";

interface Options {
  conversationId: string | null;
  serverMode: CopilotChatMode | undefined;
  onPersisted?: (conversation: CopilotConversation) => void;
}

interface LocalMode {
  id: string | null;
  mode: CopilotChatMode;
}

export function useCopilotConversationMode({ conversationId, serverMode, onPersisted }: Options) {
  const { t } = useLanguage();
  const [localMode, setModeState] = useState<LocalMode>();
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set());
  const pending = useRef(new Map<string, Promise<CopilotChatMode>>());
  const mode = localMode?.id === conversationId ? localMode.mode : serverMode ?? "execute";
  const current = useRef({ conversationId, mode, onPersisted });
  current.current = { conversationId, mode, onPersisted };

  const setLocalMode = useCallback((next: CopilotChatMode, id: string | null = current.current.conversationId) => {
    if (current.current.conversationId === id) current.current.mode = next;
    setModeState({ id, mode: next });
  }, []);

  useEffect(() => {
    if (!serverMode || (conversationId && pending.current.has(conversationId))) return;
    setModeState(previous => previous?.id === conversationId ? undefined : previous);
  }, [conversationId, serverMode]);

  const setMode = useCallback((next: CopilotChatMode) => {
    const { mode: previous, conversationId: id } = current.current;
    if (next === previous) return;
    setLocalMode(next);
    if (!id) return;

    setSaving(ids => new Set(ids).add(id));
    // Serialize updates for this conversation so a slower, older PATCH cannot
    // overwrite the most recent toggle on the server.
    const queue = pending.current;
    const update = async (persisted: CopilotChatMode) => {
      try {
        const { conversation } = await updateConversationMode(id, next);
        if (queue.get(id) === request) current.current.onPersisted?.(conversation);
        return conversation.mode ?? next;
      } catch {
        if (current.current.conversationId === id && queue.get(id) === request) {
          setLocalMode(persisted);
          toast.error(t("copilot.modePersistFailed"));
        }
        return persisted;
      }
    };
    const previousRequest = queue.get(id);
    const request = previousRequest ? previousRequest.then(update) : Promise.resolve(previous).then(update);
    queue.set(id, request);
    void request.then(() => {
      if (queue.get(id) !== request) return;
      queue.delete(id);
      setSaving(ids => {
        const next = new Set(ids);
        next.delete(id);
        return next;
      });
    });
  }, [setLocalMode, t]);

  return { mode, setMode, setLocalMode, modeSaving: conversationId !== null && saving.has(conversationId) };
}

/**
 * A successful new enter_plan_mode receipt reflects a server-side mode change.
 * Results from the first loaded transcript remain historical.
 */
export function useEnterPlanModeSync(conversationId: string | null, messages: CopilotMessage[], onEnterPlan: () => void) {
  const state = useRef<{ id: string | null; primed: boolean; seen: Set<string> }>({ id: null, primed: false, seen: new Set() });
  const callback = useRef(onEnterPlan);
  callback.current = onEnterPlan;
  useEffect(() => {
    if (state.current.id !== conversationId) state.current = { id: conversationId, primed: false, seen: new Set() };
    const scoped = messages.filter(message => message.conversationId === conversationId);
    const results = scoped.filter(message => parseEnterPlanMode(message) !== null);
    const fresh = results.filter(message => !state.current.seen.has(message.id));
    fresh.forEach(message => state.current.seen.add(message.id));
    if (!state.current.primed) {
      if (scoped.length > 0) state.current.primed = true;
      return;
    }
    if (fresh.length > 0) callback.current();
  }, [conversationId, messages]);
}
