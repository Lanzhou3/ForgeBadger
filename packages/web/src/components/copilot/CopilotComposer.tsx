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
import type { CopilotChatMode, CopilotFollowup } from "@/lib/copilot-api";
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
  onModelPicked?: (modelId: string | null) => void;
  /** Plan model shown in place of the stored preference while in Plan Mode. */
  modelOverrideId?: string | null;
  toolbarDisabled: boolean;
  followups: CopilotFollowup[];
  onCancelFollowup: (id: string) => void;
  mode?: CopilotChatMode;
  onModeChange?: (mode: CopilotChatMode) => void;
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
  onModelPicked,
  modelOverrideId,
  toolbarDisabled,
  followups,
  onCancelFollowup,
  mode = "execute",
  onModeChange,
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
          className={cn(
            "rounded-xl border bg-card shadow-raised motion-safe:transition-[border-color,box-shadow] motion-safe:duration-150 focus-within:ring-2",
            mode === "plan"
              ? "border-amber-500/45 focus-within:border-amber-500/70 focus-within:ring-amber-500/15"
              : "border-border/75 focus-within:border-brand/55 focus-within:ring-brand/15",
          )}
        >
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (onModeChange && event.key === "Tab" && event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (!event.repeat) onModeChange(mode === "plan" ? "execute" : "plan");
                return;
              }
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
            aria-keyshortcuts={onModeChange ? "Shift+Tab" : undefined}
            placeholder={isRunning ? t("copilot.followups.placeholder") : mode === "plan" ? t("copilot.planPlaceholder") : t("copilot.placeholder")}
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
                {...(onModelPicked ? { onModelPicked } : {})}
                {...(modelOverrideId ? { modelOverrideId } : {})}
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
              {onModeChange && (
                <div
                  role="group"
                  aria-label={t("copilot.chatMode")}
                  title={t("copilot.modeShortcut")}
                  data-testid="copilot-mode-toggle"
                  className="inline-flex shrink-0 items-center rounded-md border border-border/65 bg-muted/35 p-0.5"
                >
                  {(["plan", "execute"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={mode === option}
                      onClick={() => onModeChange(option)}
                      className={cn(
                        "min-h-6 rounded px-2 text-[11px] font-medium leading-none motion-safe:transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        mode !== option && "text-muted-foreground hover:text-foreground",
                        mode === option && (option === "plan"
                          ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                          : "bg-background text-foreground shadow-sm"),
                      )}
                    >
                      {t(option === "plan" ? "copilot.modePlan" : "copilot.modeExecute")}
                    </button>
                  ))}
                </div>
              )}
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
