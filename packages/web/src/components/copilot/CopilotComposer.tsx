"use client";

import type { RefObject } from "react";
import { Send, Slash, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CommandPalettePopup, useCommandPalette } from "@/components/copilot/command-palette-popup";
import { CopilotComposerToolbar } from "@/components/copilot/CopilotComposerToolbar";
import { CopilotFollowupChips } from "@/components/copilot/CopilotFollowupChips";
import { useAutoGrowTextarea } from "@/hooks/use-auto-grow-textarea";
import { useLanguage } from "@/hooks/use-language";
import type { Project } from "@/lib/api";
import type { CopilotFollowup } from "@/lib/copilot-api";
import { cn } from "@/lib/utils";

interface CopilotComposerProps {
  testId: "copilot-composer" | "robot-chat-composer";
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  canStop: boolean;
  isRunning: boolean;
  isBusy: boolean;
  sendDisabled: boolean;
  projects: Project[];
  projectId: string;
  conversationId: string | null;
  onProjectChange: (id: string) => void;
  onModelChange: (id: string | null) => void;
  onSavingChange: (saving: boolean) => void;
  toolbarDisabled: boolean;
  followups: CopilotFollowup[];
  onCancelFollowup: (id: string) => void;
  compact?: boolean;
}

/**
 * Unified integrated chat composer card shared by the /copilot console and the
 * floating robot quick-chat panel. Hosts the queued follow-up chips and slash-
 * command palette above the card, the auto-growing textarea, and an embedded
 * footer bar with context pills, `/` trigger, keyboard hint, and send/stop.
 */
export function CopilotComposer({
  testId,
  textareaRef,
  input,
  onInputChange,
  onSubmit,
  onStop,
  canStop,
  isRunning,
  isBusy,
  sendDisabled,
  projects,
  projectId,
  conversationId,
  onProjectChange,
  onModelChange,
  onSavingChange,
  toolbarDisabled,
  followups,
  onCancelFollowup,
  compact = false,
}: CopilotComposerProps) {
  const { t } = useLanguage();

  const applySlashCommand = (text: string) => {
    onInputChange(text);
    textareaRef.current?.focus();
  };
  const palette = useCommandPalette(input, applySlashCommand);

  useAutoGrowTextarea(textareaRef, input);

  const openSlashMenu = () => {
    if (!input.startsWith("/")) {
      onInputChange(input ? `/${input}` : "/");
    }
    textareaRef.current?.focus();
  };

  return (
    <div className="relative">
      {conversationId ? (
        <CopilotFollowupChips items={followups} onCancel={onCancelFollowup} />
      ) : null}

      <div className="relative">
        <CommandPalettePopup
          view={palette.view}
          onHoverItem={palette.hoverItem}
          onPickItem={palette.pickItem}
        />

        <div
          data-testid={testId}
          className="rounded-xl border border-border/75 bg-card shadow-raised transition-[border-color,box-shadow] duration-150 focus-within:border-brand/55 focus-within:ring-2 focus-within:ring-brand/15"
        >
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (palette.handleTextareaKeyDown(event)) return;
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                onSubmit();
              }
            }}
            role="combobox"
            aria-expanded={palette.view.open}
            aria-controls="command-palette"
            aria-activedescendant={
              palette.view.open && palette.view.highlighted
                ? `command-option-${palette.view.highlighted}`
                : undefined
            }
            aria-autocomplete="list"
            placeholder={isRunning ? t("copilot.followups.placeholder") : t("copilot.placeholder")}
            aria-label={t("copilot.placeholder")}
            className={cn(
              "w-full flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent px-3.5 pb-1.5 pt-3 shadow-none focus-visible:ring-0 dark:bg-transparent",
              compact ? "min-h-[40px] max-h-32" : "min-h-[46px] max-h-44",
            )}
            rows={compact ? 1 : 2}
          />

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 px-2.5 py-1.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              <CopilotComposerToolbar
                projects={projects}
                projectId={projectId}
                conversationId={conversationId}
                onProjectChange={onProjectChange}
                onModelChange={onModelChange}
                onSavingChange={onSavingChange}
                disabled={toolbarDisabled}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 sm:size-6 shrink-0 rounded-md border border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                aria-label={t("copilot.slashCommands")}
                title={t("copilot.slashCommands")}
                onClick={openSlashMenu}
              >
                <Slash className="size-3" aria-hidden="true" />
              </Button>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {!compact ? (
                <span className="hidden text-[11px] text-muted-foreground/70 lg:inline">
                  {t("copilot.composerHint")}
                </span>
              ) : null}

              {isBusy ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className={cn("shrink-0 rounded-full", compact ? "size-7" : "size-8")}
                  onClick={onStop}
                  disabled={!canStop}
                  aria-label={t("copilot.stop")}
                  title={t("copilot.stop")}
                >
                  <Square className="size-3.5" />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="icon"
                  className={cn("shrink-0 rounded-full", compact ? "size-7" : "size-8")}
                  onClick={onSubmit}
                  disabled={sendDisabled}
                  aria-label={t("copilot.send")}
                  title={t("copilot.send")}
                >
                  <Send className={compact ? "size-3.5" : "size-4"} />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
