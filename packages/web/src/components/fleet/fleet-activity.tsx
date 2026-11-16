"use client";

import { CircleDashed, Clock } from "lucide-react";

import { useUiLocale } from "@/hooks/use-language";
import type { FleetJournalEntry, FleetTask, FleetTimer } from "@/lib/fleet-api";
import { useFleetCopy } from "./fleet-copy";

interface Props {
  journal: FleetJournalEntry[];
  timers: FleetTimer[];
  tasks: FleetTask[];
}

/** What the flagship wrote down lately and what is scheduled to wake it. */
export function FleetActivity({ journal, timers, tasks }: Props) {
  const copy = useFleetCopy();
  const locale = useUiLocale();
  const seqById = new Map(tasks.map((task) => [task.id, task.seq]));
  const entries = [...journal].sort((a, b) => b.createdAt - a.createdAt);
  const upcoming = [...timers].sort((a, b) => a.dueAt - b.dueAt);
  const stamp = (value: number) => new Date(value).toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <section aria-label={copy.activityTitle} className="rounded-lg border border-border bg-card">
      <div className="border-b border-border/70 px-4 py-3">
        <h2 className="text-sm font-semibold">{copy.activityTitle}</h2>
      </div>
      <div className="space-y-4 px-4 py-3">
        <div>
          <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">{copy.timersTitle}</h3>
          {upcoming.length === 0 ? (
            <p className="text-xs text-muted-foreground">{copy.timersEmpty}</p>
          ) : (
            <ul className="space-y-1.5">
              {upcoming.map((timer) => (
                <li key={timer.id} className="flex items-start gap-2 text-xs">
                  <Clock className="mt-0.5 size-3.5 shrink-0 text-hue-gold" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="break-words">
                      {timer.taskId && seqById.has(timer.taskId) ? <span className="mr-1.5 font-mono text-muted-foreground">#{seqById.get(timer.taskId)}</span> : null}
                      {timer.note}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{copy.timerDue(stamp(timer.dueAt))}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">{copy.journalEmpty}</p>
        ) : (
          <ul className="max-h-96 space-y-2.5 overflow-y-auto">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-start gap-2">
                <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {entry.taskId && seqById.has(entry.taskId) ? <span className="mr-1.5 font-mono text-xs text-muted-foreground">#{seqById.get(entry.taskId)}</span> : null}
                    {entry.note}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/70">{stamp(entry.createdAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
