"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TerminalSquare } from "lucide-react";

import { listCopilotCommands, type CopilotCommandInfo } from "@/lib/copilot-api";
import { useCopilotCommandsCopy } from "@/lib/copilot-commands-copy";
import { cn } from "@/lib/utils";

export const copilotCommandsQueryKey = ["copilot-commands"] as const;

type SlashPhase =
  | { kind: "palette"; query: string }
  | { kind: "hint"; name: string }
  | { kind: "hidden" };

/** Typing the command name ("/" prefix, no space yet) opens the palette; the
 * first space switches to the argument phase, which only shows a usage hint. */
function parseSlashInput(input: string): SlashPhase {
  if (!input.startsWith("/")) return { kind: "hidden" };
  const spaceIndex = input.indexOf(" ");
  if (spaceIndex === -1) return { kind: "palette", query: input.slice(1).toLowerCase() };
  return { kind: "hint", name: input.slice(1, spaceIndex).toLowerCase() };
}

/** Subsequence match with ranking: exact < prefix (shorter first) < fuzzy
 * (earlier first match, then shorter). Returns null when query is no
 * subsequence of name. */
function matchScore(name: string, query: string): number | null {
  if (!query) return 0;
  let matched = 0;
  let firstIndex = -1;
  for (let i = 0; i < name.length && matched < query.length; i += 1) {
    if (name[i] === query[matched]) {
      if (firstIndex === -1) firstIndex = i;
      matched += 1;
    }
  }
  if (matched < query.length) return null;
  if (name === query) return 0;
  if (name.startsWith(query)) return 1 + name.length / 100;
  return 2 + firstIndex / 100 + name.length / 10000;
}

const CATEGORY_ORDER = ["goal", "session", "model", "info"] as const;

export interface CommandPaletteItem {
  name: string;
  usage: string;
  description: string;
}

export interface CommandPaletteGroup {
  category: string;
  label: string;
  items: CommandPaletteItem[];
}

export interface CommandPaletteView {
  /** True while the full palette panel should render. */
  open: boolean;
  groups: CommandPaletteGroup[];
  /** Currently highlighted command name, or null when nothing matches. */
  highlighted: string | null;
  /** True when the palette is open but the filter matched nothing. */
  empty: boolean;
  /** One-line usage hint for the argument phase, or null. */
  hint: CommandPaletteItem | null;
}

function localize(command: CopilotCommandInfo, description: string): CommandPaletteItem {
  return { name: command.name, usage: command.usage, description };
}

/**
 * Slash-command palette state for a chat composer. The parent renders
 * <CommandPalettePopup view={...} /> above the textarea and forwards the
 * textarea's onKeyDown to handleTextareaKeyDown; a true return value means the
 * palette consumed the key (parent must skip its default Enter/Escape
 * handling). Selecting a command fills "/name " into the input via onApply and
 * focuses the textarea — submission itself goes through the surface's normal
 * send path, so a running turn queues it through the existing follow-ups
 * mechanism.
 */
export function useCommandPalette(input: string, onApply: (text: string) => void) {
  const copy = useCopilotCommandsCopy();
  const commandsQuery = useQuery({
    queryKey: copilotCommandsQueryKey,
    queryFn: listCopilotCommands,
    staleTime: Infinity,
  });
  const [dismissed, setDismissed] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const phase = useMemo(() => parseSlashInput(input), [input]);
  useEffect(() => {
    setDismissed(false);
    setHighlighted(null);
  }, [input]);

  const commands = useMemo(() => commandsQuery.data?.commands ?? [], [commandsQuery.data]);

  const groups = useMemo<CommandPaletteGroup[]>(() => {
    if (phase.kind !== "palette") return [];
    const scored = commands
      .map((command) => ({ command, score: matchScore(command.name, phase.query) }))
      .filter((entry): entry is { command: CopilotCommandInfo; score: number } => entry.score !== null)
      .sort((a, b) => a.score - b.score);
    return CATEGORY_ORDER.map((category) => {
      const items = scored
        .filter((entry) => entry.command.category === category)
        .map((entry) => localize(entry.command, copy.descriptions[entry.command.name] ?? entry.command.description));
      return items.length > 0
        ? { category, label: copy.categories[category] ?? category, items } satisfies CommandPaletteGroup
        : null;
    }).filter((group) => group !== null);
  }, [commands, phase, copy]);

  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const activeHighlight =
    highlighted !== null && flat.some((item) => item.name === highlighted)
      ? highlighted
      : (flat[0]?.name ?? null);

  const hint = useMemo<CommandPaletteItem | null>(() => {
    if (phase.kind !== "hint") return null;
    const command = commands.find((entry) => entry.name.toLowerCase() === phase.name);
    return command ? localize(command, copy.descriptions[command.name] ?? command.description) : null;
  }, [phase, commands, copy]);

  const open = phase.kind === "palette" && !dismissed && commandsQuery.data !== undefined;

  const handleTextareaKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      // IME composition must keep its default behavior (candidate selection).
      if (event.nativeEvent.isComposing) return false;
      if (phase.kind !== "palette" || dismissed) return false;
      if (event.key === "Escape") {
        setDismissed(true);
        event.preventDefault();
        return true;
      }
      if (flat.length === 0) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const index = Math.max(0, flat.findIndex((item) => item.name === activeHighlight));
        const next = flat[(index + (event.key === "ArrowDown" ? 1 : flat.length - 1)) % flat.length];
        setHighlighted(next?.name ?? null);
        event.preventDefault();
        return true;
      }
      if ((event.key === "Enter" || event.key === "Tab") && activeHighlight) {
        onApply(`/${activeHighlight} `);
        event.preventDefault();
        return true;
      }
      return false;
    },
    [phase.kind, dismissed, flat, activeHighlight, onApply],
  );

  const view: CommandPaletteView = {
    open,
    groups,
    highlighted: activeHighlight,
    empty: open && flat.length === 0,
    hint: phase.kind === "hint" && !dismissed ? hint : null,
  };

  return {
    view,
    handleTextareaKeyDown,
    /** Mouse interaction entry points for the popup. */
    hoverItem: (name: string) => setHighlighted(name),
    pickItem: (name: string) => onApply(`/${name} `),
  };
}

interface CommandPalettePopupProps {
  view: CommandPaletteView;
  onHoverItem: (name: string) => void;
  onPickItem: (name: string) => void;
}

/** Floating slash-command palette above the chat composer (Codex/Claude Code
 * pattern). Rendered inside the composer's relative wrapper; also renders the
 * single-line usage hint once the input enters the argument phase. */
export function CommandPalettePopup({ view, onHoverItem, onPickItem }: CommandPalettePopupProps) {
  const copy = useCopilotCommandsCopy();
  if (view.open) {
    return (
      <div
        id="command-palette"
        role="listbox"
        aria-label={copy.paletteLabel}
        data-testid="command-palette"
        className="absolute inset-x-0 bottom-full z-30 mb-1.5 overflow-hidden rounded-lg border border-border bg-card shadow-xl shadow-black/30"
      >
        <div className="max-h-64 overflow-y-auto p-1">
          {view.empty ? (
            <p role="status" className="px-2 py-3 text-xs text-muted-foreground">{copy.noMatch}</p>
          ) : (
            view.groups.map((group) => (
              <div key={group.category}>
                <p className="px-2 pt-1.5 pb-0.5 text-[11px] font-medium text-muted-foreground">{group.label}</p>
                {group.items.map((item) => {
                  const isActive = item.name === view.highlighted;
                  return (
                    <button
                      key={item.name}
                      type="button"
                      id={`command-option-${item.name}`}
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => onHoverItem(item.name)}
                      onClick={() => onPickItem(item.name)}
                      className={cn(
                        "flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left",
                        isActive ? "bg-brand/10 text-foreground" : "text-muted-foreground hover:bg-muted/60",
                      )}
                    >
                      <span className="shrink-0 font-mono text-sm font-semibold">/{item.name}</span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground/80">
                        {item.usage.startsWith(`/${item.name}`) ? item.usage.slice(item.name.length + 1) : item.usage}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{item.description}</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    );
  }
  if (view.hint) {
    return (
      <div
        data-testid="command-usage-hint"
        className="absolute inset-x-0 bottom-full z-30 mb-1.5 flex items-baseline gap-2 rounded-md border border-border/70 bg-card/95 px-2.5 py-1.5 shadow-lg shadow-black/20"
      >
        <TerminalSquare className="size-3.5 shrink-0 self-center text-muted-foreground" aria-hidden />
        <span className="shrink-0 font-mono text-xs font-semibold">{view.hint.usage}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{view.hint.description}</span>
      </div>
    );
  }
  return null;
}
