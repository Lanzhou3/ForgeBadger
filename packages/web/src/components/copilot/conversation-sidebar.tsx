"use client";

import { useEffect, useRef, useState } from "react";
import { Check, MessageSquare, Pencil, Plus, Search, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/hooks/use-language";
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
      <div className="space-y-2 border-b p-3">
        <Button size="sm" className="w-full justify-start gap-2" onClick={onCreate} disabled={creating}>
          <Plus className="size-4" />
          {t("copilot.newConversation")}
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("copilot.search")}
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.map((conversation) => {
          const isActive = conversation.id === activeId;
          return (
            <div
              key={conversation.id}
              className={`group relative border-b transition-colors ${
                isActive ? "bg-muted" : "hover:bg-muted/50"
              }`}
            >
              {renamingId === conversation.id ? (
                <div className="flex items-center gap-1 p-2">
                  <Input
                    ref={renameInputRef}
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void submitRename();
                      if (event.key === "Escape") setRenamingId(null);
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
                  className="block w-full px-3 py-2 pr-16 text-left"
                >
                  <span className="flex items-center gap-1.5 text-sm">
                    <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      {conversation.title || t("copilot.untitled")}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {formatConversationTime(conversation.updated_at)}
                  </span>
                </button>
              )}
              {renamingId !== conversation.id && deletingId !== conversation.id && (
                <div className="absolute right-1.5 top-1.5 hidden gap-0.5 group-hover:flex">
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
          <p className="p-3 text-xs text-muted-foreground">{t("copilot.noConversations")}</p>
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
