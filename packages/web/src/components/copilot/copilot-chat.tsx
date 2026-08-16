"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/hooks/use-language";
import { useCopilotRun } from "@/hooks/use-copilot";
import {
  createConversation,
  listConversations,
  listMessages,
  type CopilotConversation,
  type CopilotMessage,
  type CopilotPendingAction,
} from "@/lib/copilot-api";

/**
 * Copilot chat — the primary conversational surface. Lets the user converse
 * with the platform agent, watch it stream a turn, and approve/reject the
 * operate tools it proposes. The whole platform is the copilot's tool surface.
 */
export function CopilotChat() {
  const { t } = useLanguage();
  const { active, startRun, approveAction, clearActive } = useCopilotRun();

  const [conversations, setConversations] = useState<CopilotConversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const refreshConversations = useCallback(async () => {
    try {
      const { conversations } = await listConversations();
      setConversations(conversations);
      const first = conversations[0];
      if (!conversationId && first) {
        selectConversation(first.id);
      }
    } catch {
      setLoadError(t("copilot.loadError"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  const selectConversation = useCallback(async (id: string) => {
    setConversationId(id);
    setLoadError(null);
    try {
      const { messages } = await listMessages(id);
      setMessages(messages);
    } catch {
      setLoadError(t("copilot.loadError"));
    }
  }, [t]);

  const newConversation = useCallback(async () => {
    try {
      const { conversation } = await createConversation();
      await refreshConversations();
      await selectConversation(conversation.id);
    } catch {
      setLoadError(t("copilot.loadError"));
    }
  }, [refreshConversations, selectConversation, t]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !conversationId || sending) return;
    const userMessage: CopilotMessage = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      conversationId,
      userId: "",
      role: "user",
      kind: "text",
      content: text,
      sequence: messages.length + 1,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setSending(true);
    clearActive();
    try {
      await startRun(conversationId, text);
    } catch {
      setLoadError(t("copilot.sendError"));
    } finally {
      setSending(false);
    }
  }, [input, conversationId, sending, messages.length, startRun, clearActive, t]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, active?.text]);

  const onDecide = useCallback(
    async (approved: boolean) => {
      if (!active?.pendingAction) return;
      await approveAction(active.runId, active.pendingAction.id, approved);
    },
    [active, approveAction]
  );

  const displayMessages = [...messages];
  if (active && active.text) {
    displayMessages.push({
      id: `stream-${active.runId}`,
      conversationId: active.conversationId,
      userId: "",
      role: "assistant",
      kind: "text",
      content: active.text,
      sequence: messages.length + 1,
      createdAt: new Date().toISOString(),
    });
  }

  return (
    <div className="mx-auto grid h-full max-w-7xl grid-cols-[280px_1fr] gap-4 p-6">
      {/* Conversation list */}
      <Card className="flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b p-3">
          <span className="text-sm font-semibold">{t("copilot.conversations")}</span>
          <Button variant="outline" size="sm" onClick={() => void newConversation()}>
            {t("copilot.newConversation")}
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              onClick={() => void selectConversation(conversation.id)}
              className={`block w-full truncate border-b px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                conversation.id === conversationId ? "bg-muted" : ""
              }`}
            >
              {conversation.title || t("copilot.untitled")}
            </button>
          ))}
          {conversations.length === 0 && (
            <p className="p-3 text-xs text-muted-foreground">{t("copilot.noConversations")}</p>
          )}
        </div>
      </Card>

      {/* Chat surface */}
      <Card className="flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden">
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {loadError && <p className="text-sm text-destructive">{loadError}</p>}
          {displayMessages.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("copilot.empty")}</p>
          )}
          {displayMessages.map((message) => (
            <MessageRow key={message.id} message={message} />
          ))}
          {active?.pendingAction && (
            <PendingActionRow action={active.pendingAction} onDecide={onDecide} />
          )}
        </div>
        <div className="border-t p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={t("copilot.placeholder")}
              className="min-h-[48px] max-h-40 flex-1 resize-none"
              rows={2}
            />
            <Button onClick={() => void send()} disabled={sending || !input.trim() || !conversationId}>
              {t("copilot.send")}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function MessageRow({ message }: { message: CopilotMessage }) {
  const isUser = message.role === "user";

  if (message.kind === "tool_call") {
    return (
      <div className="rounded-md bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
        🔧 {message.toolName ?? message.content}
      </div>
    );
  }
  if (message.kind === "tool_result") {
    return (
      <div className="max-w-[85%] rounded-md bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
        {truncateContent(message.content)}
      </div>
    );
  }
  if (message.kind === "error") {
    return <div className="text-sm text-destructive">{message.content}</div>;
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}

function PendingActionRow({
  action,
  onDecide,
}: {
  action: CopilotPendingAction;
  onDecide: (approved: boolean) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/30">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">
          {t("copilot.approvalRequired")}
        </Badge>
        <span className="text-sm font-medium">{action.tool}</span>
      </div>
      {action.inputJson && (
        <pre className="max-h-40 overflow-auto rounded bg-background p-2 text-xs">{action.inputJson}</pre>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void onDecide(true)}>
          {t("copilot.approve")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void onDecide(false)}>
          {t("copilot.reject")}
        </Button>
      </div>
    </div>
  );
}

function truncateContent(content: string): string {
  const max = 600;
  return content.length > max ? `${content.slice(0, max)}…` : content;
}
