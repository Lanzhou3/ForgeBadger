"use client";

import { useEffect, useRef, useState } from "react";
import { Check, MessageSquare, Pencil, Plus, Search, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/hooks/use-language";
import { cn } from "@/lib/utils";
import type { CopilotConversation } from "@/lib/copilot-api";

export interface ConversationSidebarProps {
  conversations: CopilotConversation[];
  activeId: string | null;
  creating: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

/**
 * Conversation history sidebar (ChatGPT/Claude pattern): new chat, client-side
 * title search, inline rename, and delete with confirmation.
 */
export function ConversationSidebar({
  conversations,
  activeId,
  creating,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: ConversationSidebarProps) {
  const { t } = useLanguage();
  const [search, setSearch] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  const query = search.trim().toLowerCase();
  const visible = query
    ? conversations.filter((conversation) =>
        (conversation.title ?? t("copilot.untitled")).toLowerCase().includes(query)
      )
    : conversations;

  const startRename = (conversation: CopilotConversation) => {
    setRenamingId(conversation.id);
    setRenameDraft(conversation.title ?? "");
  };

  const submitRename = async () => {
    const id = renamingId;
    const title = renameDraft.trim();
    setRenamingId(null);
    if (id && title) await onRename(id, title);
  };

  const confirmDelete = async () => {
    const id = deletingId;
    setDeletingId(null);
    if (id) await onDelete(id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-border/60 p-3">
        <Button
          size="sm"
          variant="outline"
          className="w-full justify-start gap-2 bg-card/75 shadow-card hover:bg-card"
          onClick={onCreate}
          disabled={creating}
        >
          <Plus className="size-4 text-brand" strokeWidth={1.75} />
          {t("copilot.newConversation")}
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("copilot.search")}
            aria-label={t("copilot.search")}
            className="h-8 border-border/60 bg-card/55 pl-8 text-sm backdrop-blur-sm"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        {visible.map((conversation) => {
          const isActive = conversation.id === activeId;
          return (
            <div
              key={conversation.id}
              className={cn(
                "group relative rounded-lg transition-[background-color,box-shadow] duration-150",
                isActive
                  ? "bg-card/90 shadow-card ring-1 ring-border/70"
                  : "hover:bg-foreground/[0.04]"
              )}
            >
              {isActive && renamingId !== conversation.id && deletingId !== conversation.id && (
                <span
                  className="pointer-events-none absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-brand"
                  aria-hidden="true"
                />
              )}
              {renamingId === conversation.id ? (
                <div className="flex items-center gap-1 p-2">
                  <Input
                    ref={renameInputRef}
                    value={renameDraft}
                    aria-label={t("copilot.rename")}
                    data-conversation-rename=""
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        void submitRename();
                      }
                      if (event.key === "Escape") { event.preventDefault(); setRenamingId(null); }
                    }}
                    maxLength={200}
                    className="h-7 text-sm"
                  />
                  <Button variant="ghost" size="icon" className="size-7" onClick={() => void submitRename()} aria-label={t("copilot.rename")}>
                    <Check className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" onClick={() => setRenamingId(null)} aria-label={t("common.cancel")}>
                    <X className="size-3.5" />
                  </Button>
                </div>
              ) : deletingId === conversation.id ? (
                <div className="flex items-center justify-between gap-2 p-2">
                  <span className="truncate text-xs text-muted-foreground">{t("copilot.deleteConversationConfirm")}</span>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="destructive" size="sm" className="h-7" onClick={() => void confirmDelete()}>
                      {t("copilot.deleteConversation")}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7" onClick={() => setDeletingId(null)}>
                      {t("common.cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => onSelect(conversation.id)}
                  aria-current={isActive ? "page" : undefined}
                  className="block w-full rounded-lg px-2.5 py-2 pr-14 text-left md:pr-2.5 md:group-hover:pr-14 md:group-focus-within:pr-14"
                >
                  <span className="flex items-center gap-1.5 text-[13px]">
                    <MessageSquare strokeWidth={1.75} className={cn("size-3.5 shrink-0", isActive ? "text-brand" : "text-muted-foreground")} />
                    <span className={cn("truncate", isActive && "font-medium")}>
                      {conversation.title || t("copilot.untitled")}
                    </span>
                  </span>
                  <span className="mt-0.5 block pl-5 text-[11px] text-muted-foreground">
                    {formatConversationTime(conversation.updated_at)}
                  </span>
                </button>
              )}
              {renamingId !== conversation.id && deletingId !== conversation.id && (
                <div className="absolute right-1.5 top-1.5 flex gap-0.5 rounded-md bg-card/85 px-0.5 backdrop-blur-sm transition-opacity duration-150 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label={t("copilot.rename")}
                    onClick={() => startRename(conversation)}
                  >
                    <Pencil className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-destructive"
                    aria-label={t("copilot.deleteConversation")}
                    onClick={() => setDeletingId(conversation.id)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
        {visible.length === 0 && (
          <p className="p-3 text-center text-xs text-muted-foreground">{t("copilot.noConversations")}</p>
        )}
      </div>
    </div>
  );
}

/** Short sidebar timestamp: time for today, date otherwise (updated_at is ms). */
export function formatConversationTime(updatedAtMs: number): string {
  const date = new Date(updatedAtMs);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const pad = (value: number) => String(value).padStart(2, "0");
  return sameDay
    ? `${pad(date.getHours())}:${pad(date.getMinutes())}`
    : `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
