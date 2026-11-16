"use client";

import { useLayoutEffect, useRef } from "react";
import {
  Bot,
  CircleDashed,
  Flag,
  GitMerge,
  Hand,
  PenLine,
  ScanSearch,
  ShieldCheck,
  X,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";

import type { CopilotGoalTeam } from "@/lib/copilot-api";
import { cn } from "@/lib/utils";
import {
  currentStageIndex,
  type FlowStage,
  type FlowStageId,
} from "../copilot/goal-task-flow-model";
import { MemberAvatar, memberHue } from "../copilot/goal-team-strip";
import { useGoalsCopy } from "../copilot/goals-copy";
import { FLEET_COLUMNS, type FleetBoardModel, type FleetCardModel, type FleetColumnId } from "./fleet-board-model";
import { taskSentence, useFleetCopy } from "./fleet-copy";
import "../copilot/goal-task-flow.css";

interface ColumnMeta {
  icon: LucideIcon;
  tile: string;
  bar: string;
  count: string;
}

// Hues match the stage nodes of the task track: write sky, verify mint, review iris, integrate gold, done mint.
const COLUMN_META: Record<FleetColumnId, ColumnMeta> = {
  queue: { icon: CircleDashed, tile: "bg-muted text-muted-foreground", bar: "bg-muted-foreground/30", count: "bg-muted text-muted-foreground" },
  write: { icon: PenLine, tile: "bg-hue-sky/12 text-hue-sky", bar: "bg-hue-sky", count: "bg-hue-sky/12 text-hue-sky" },
  verify: { icon: ShieldCheck, tile: "bg-hue-mint/12 text-hue-mint", bar: "bg-hue-mint", count: "bg-hue-mint/12 text-hue-mint" },
  review: { icon: ScanSearch, tile: "bg-hue-iris/12 text-hue-iris", bar: "bg-hue-iris", count: "bg-hue-iris/12 text-hue-iris" },
  integrate: { icon: GitMerge, tile: "bg-hue-gold/12 text-hue-gold", bar: "bg-hue-gold", count: "bg-hue-gold/12 text-hue-gold" },
  owner: { icon: Hand, tile: "bg-brand-accent/12 text-brand-accent", bar: "bg-brand-accent", count: "bg-brand-accent/12 text-brand-accent" },
  done: { icon: Flag, tile: "bg-hue-mint/12 text-hue-mint", bar: "bg-hue-mint", count: "bg-hue-mint/12 text-hue-mint" },
};

const DOT_HUE: Record<FlowStageId, string> = {
  write: "bg-hue-sky",
  verify: "bg-hue-mint",
  review: "bg-hue-iris",
  integrate: "bg-hue-gold",
  pass: "bg-hue-mint",
};

const SENTENCE_CLASS = {
  member: "text-brand",
  reviewer: "text-hue-iris",
  lead: "text-muted-foreground",
  owner: "text-brand-accent",
  queued: "text-muted-foreground",
  done: "text-hue-mint",
  stopped: "text-muted-foreground",
} as const;

const TRACK_SLOTS: FlowStageId[] = ["write", "verify", "review", "integrate", "pass"];

interface BoardProps {
  board: FleetBoardModel;
  roster: CopilotGoalTeam | undefined;
  /** The fleet is running: the live link and node animate. */
  live: boolean;
  selectedId: string | null;
  onOpen: (taskId: string) => void;
}

/** Seven columns, one card per task. A card that changes column travels to its new place instead of jumping. */
export function FleetBoard({ board, roster, live, selectedId, onOpen }: BoardProps) {
  const copy = useFleetCopy();
  const rootRef = useRef<HTMLDivElement>(null);
  useFlip(rootRef);
  return (
    <div
      ref={rootRef}
      role="region"
      aria-label={copy.boardTitle}
      className={cn("grid grid-flow-col auto-cols-[minmax(10.5rem,1fr)] gap-2 overflow-x-auto pb-1", live && "fb-flow-live")}
    >
      {FLEET_COLUMNS.map((column) => (
        <Column key={column} id={column} cards={board[column]} roster={roster} selectedId={selectedId} onOpen={onOpen} />
      ))}
    </div>
  );
}

function Column({ id, cards, roster, selectedId, onOpen }: {
  id: FleetColumnId; cards: FleetCardModel[]; roster: CopilotGoalTeam | undefined; selectedId: string | null; onOpen: (taskId: string) => void;
}) {
  const copy = useFleetCopy();
  const meta = COLUMN_META[id];
  const Icon = meta.icon;
  const calling = id === "owner" && cards.length > 0;
  const firstCancelled = cards.findIndex((card) => card.cancelled);
  return (
    <section
      aria-label={copy.columns[id]}
      data-column={id}
      className={cn(
        "relative flex min-h-48 min-w-0 flex-col rounded-lg border bg-muted/20",
        calling ? "border-brand-accent/50 bg-brand-accent/[0.04]" : "border-border",
      )}
    >
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-0.5 rounded-t-lg", meta.bar, cards.length === 0 && "opacity-40")} />
      <header className="flex items-center gap-2 px-2.5 pb-2 pt-3">
        <span aria-hidden className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded", meta.tile)}>
          <Icon className="size-3" />
        </span>
        <h3 className={cn("min-w-0 flex-1 truncate text-xs font-semibold", calling && "text-brand-accent")}>{copy.columns[id]}</h3>
        <span
          data-testid={`count-${id}`}
          className={cn(
            "min-w-5 rounded-full px-1.5 text-center text-[11px] font-medium tabular-nums",
            calling ? "bg-brand-accent text-brand-accent-foreground" : meta.count,
          )}
        >
          {cards.length}
        </span>
      </header>
      {cards.length === 0 ? (
        <p className="px-2.5 py-3 text-center text-[11px] text-muted-foreground/70">{copy.columnEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-2 px-2 pb-2">
          {cards.map((card, index) => (
            <li key={card.task.id} data-flip-id={card.task.id} data-flip-column={id} className="relative">
              {index === firstCancelled && index > 0 ? (
                <p className="mb-2 mt-1 border-t border-border/70 pt-2 text-[11px] text-muted-foreground">{copy.cancelledDivider}</p>
              ) : null}
              <FleetCard card={card} roster={roster} selected={selectedId === card.task.id} onOpen={() => onOpen(card.task.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FleetCard({ card, roster, selected, onOpen }: { card: FleetCardModel; roster: CopilotGoalTeam | undefined; selected: boolean; onOpen: () => void }) {
  const copy = useFleetCopy();
  const { task, flow, team } = card;
  const sentence = taskSentence(copy, task, flow);
  const workerName = team?.worker ? (team.worker.memberName ?? team.worker.adapter) : null;
  const memberId = team?.worker?.memberId ?? task.memberId;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`fleet-card-${task.seq}`}
      aria-label={`#${task.seq} ${task.description}`}
      aria-pressed={selected}
      className={cn(
        "block w-full rounded-md border bg-card p-2.5 text-left transition-colors hover:border-foreground/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        selected ? "border-brand" : card.held ? "border-brand-accent/45" : card.trouble === "failed" ? "border-destructive/40" : "border-border",
        card.cancelled && "opacity-60",
      )}
    >
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-[11px] text-muted-foreground">#{task.seq}</span>
        {card.trouble ? <TroubleMark kind={card.trouble} /> : null}
        <span className="ml-auto">
          {workerName ? (
            <span title={team?.worker?.adapter}>
              <MemberAvatar name={workerName} hue={memberHue(roster, memberId)} busy={flow.holder === "member"} className="size-5 text-[10px]" />
            </span>
          ) : (
            <span aria-hidden className="inline-flex size-5 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Bot className="size-3" />
            </span>
          )}
        </span>
      </span>
      <span className={cn("mt-1 line-clamp-2 break-words text-[13px] leading-snug", card.cancelled && "line-through")}>{task.description}</span>
      {card.held && task.hold ? (
        <span className="mt-1.5 line-clamp-2 break-words border-l-2 border-brand-accent/60 pl-2 text-[11px] leading-snug text-foreground/80">
          {task.hold.question}
        </span>
      ) : null}
      <MiniTrack stages={flow.stages} />
      <span className={cn("mt-1.5 block text-[11px] leading-snug", SENTENCE_CLASS[sentence.holder])}>{sentence.text}</span>
    </button>
  );
}

function TroubleMark({ kind }: { kind: "failed" | "attention" }) {
  const copy = useFleetCopy();
  const failed = kind === "failed";
  const Icon = failed ? X : AlertTriangle;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium", failed ? "bg-destructive/12 text-destructive" : "bg-hue-coral/12 text-hue-coral")}>
      <Icon className="size-2.5" aria-hidden />
      {failed ? copy.failedMark : copy.attentionMark}
    </span>
  );
}

/** The five-stage track at card size: same slots, states and hues as the full track, one dot per stage. */
export function MiniTrack({ stages }: { stages: FlowStage[] }) {
  const goals = useGoalsCopy();
  const current = currentStageIndex(stages);
  const label = stages.map((stage) => `${goals.stageLabels[stage.id]}: ${goals.stageStates[stage.state]}`).join(", ");
  const linkStateInto = (stage: FlowStage) => (stage.state === "active" ? "active" : stage.state === "todo" ? "todo" : "done");
  return (
    <ol role="img" aria-label={label} className="mt-2 flex items-center">
      {TRACK_SLOTS.map((slot, slotIndex) => {
        const index = stages.findIndex((stage) => stage.id === slot);
        const stage = stages[index];
        const next = stage ?? stages.find((candidate) => TRACK_SLOTS.indexOf(candidate.id) > slotIndex);
        return (
          <li key={slot} className={cn("flex items-center", slotIndex > 0 && "min-w-0 flex-1")}>
            {slotIndex > 0 && next ? <span aria-hidden className="fb-flow-link min-w-1 flex-1" data-state={linkStateInto(next)} /> : null}
            {stage ? (
              <span
                aria-hidden
                data-state={stage.state}
                className={cn(
                  "fb-flow-node size-2.5 shrink-0 rounded-full border",
                  stage.state === "done" && cn("border-transparent", DOT_HUE[stage.id]),
                  stage.state === "active" && "border-brand bg-brand",
                  stage.state === "failed" && "border-destructive bg-destructive",
                  stage.state === "attention" && "border-hue-coral bg-hue-coral",
                  stage.state === "todo" && (index === current ? "border-foreground/50 bg-card" : "border-border bg-card"),
                )}
              />
            ) : (
              <span aria-hidden className="size-1 shrink-0 rounded-full bg-border" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * FLIP: remember where every card sat after the last render and, when it sits
 * elsewhere now, play it from the old spot to the new one. A card that changed
 * column also gets one soft ring so the eye can follow it. Off under reduced
 * motion and wherever the Web Animations API is missing.
 */
function useFlip(rootRef: React.RefObject<HTMLDivElement | null>) {
  const previous = useRef(new Map<string, { x: number; y: number; column: string }>());
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const origin = root.getBoundingClientRect();
    const next = new Map<string, { x: number; y: number; column: string }>();
    root.querySelectorAll<HTMLElement>("[data-flip-id]").forEach((element) => {
      const id = element.dataset.flipId ?? "";
      const rect = element.getBoundingClientRect();
      // Relative to the board, so scrolling the page or the board is not mistaken for movement.
      const spot = { x: rect.left - origin.left + root.scrollLeft, y: rect.top - origin.top + root.scrollTop, column: element.dataset.flipColumn ?? "" };
      next.set(id, spot);
      const was = previous.current.get(id);
      if (!was || reduced || typeof element.animate !== "function") return;
      const dx = was.x - spot.x;
      const dy = was.y - spot.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      if (was.column !== spot.column) {
        element.animate(
          [
            { transform: `translate(${dx}px, ${dy}px) scale(1.04)`, zIndex: 30, boxShadow: "0 0 0 2px hsl(var(--brand) / 0.55)" },
            { transform: "translate(0, 0) scale(1)", zIndex: 30, boxShadow: "0 0 0 2px hsl(var(--brand) / 0)" },
          ],
          { duration: 560, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
        );
      } else {
        element.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
          { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
        );
      }
    });
    previous.current = next;
  });
}
