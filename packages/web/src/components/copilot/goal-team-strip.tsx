"use client";

import { Eye, PenLine } from "lucide-react";

import type { CopilotGoalTeam, CopilotGoalTask } from "@/lib/copilot-api";
import { HUE_CLASSES, type HueId } from "@/lib/hues";
import { cn } from "@/lib/utils";
import { memberActivity } from "./goal-task-flow-model";
import { useGoalsCopy } from "./goals-copy";

const MEMBER_HUES: HueId[] = ["sky", "mint", "iris", "coral", "rose", "gold"];

/** Stable hue per roster position, shared by the strip and the task rows. */
export function memberHue(team: CopilotGoalTeam | undefined, memberId: string | null | undefined): HueId {
  const index = team?.members.findIndex((member) => member.id === memberId) ?? -1;
  return MEMBER_HUES[(index < 0 ? 0 : index) % MEMBER_HUES.length]!;
}

export function MemberAvatar({ name, hue, busy, className }: { name: string; hue: HueId; busy?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold",
        HUE_CLASSES[hue].tile,
        className,
      )}
    >
      {Array.from(name.trim())[0]?.toUpperCase() ?? "?"}
      {busy ? (
        <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-brand-accent ring-2 ring-card forgebadger-pulse-dot" />
      ) : null}
    </span>
  );
}

interface Props {
  team: CopilotGoalTeam;
  tasks: CopilotGoalTask[];
  /** Heading override for owners that name the roster differently (the fleet board). */
  title?: string;
}

/** Who is on the team and what each member is doing right now. */
export function GoalTeamStrip({ team, tasks, title }: Props) {
  const copy = useGoalsCopy();
  const heading = title ?? copy.teamTitle;
  const activity = memberActivity(tasks, team.tasks);
  const busy = tasks.filter((task) => task.dispatchStatus === "running").length
    + team.tasks.filter((entry) => entry.review?.attempts.some((attempt) => attempt.status === "running")).length;
  if (team.members.length === 0) return null;
  return (
    <section aria-label={heading} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-3 py-2">
      <h2 className="text-sm font-semibold">{heading}</h2>
      <ul className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
        {team.members.map((member) => {
          const doing = activity.get(member.id);
          const Icon = doing?.kind === "reviewing" ? Eye : PenLine;
          return (
            <li key={member.id} className="flex min-w-0 items-center gap-2" title={member.title || member.adapter}>
              <MemberAvatar name={member.name} hue={memberHue(team, member.id)} busy={Boolean(doing)} />
              <div className="min-w-0 leading-tight">
                <p className="truncate text-xs font-medium">{member.name}</p>
                <p className={cn("flex items-center gap-1 text-[11px]", doing ? "text-foreground" : "text-muted-foreground")}>
                  {doing ? <Icon className="size-3 shrink-0" aria-hidden /> : null}
                  {doing ? (doing.kind === "writing" ? copy.memberWriting(doing.taskSeq) : copy.memberReviewing(doing.taskSeq)) : copy.memberIdle}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex shrink-0 items-center gap-2" title={copy.teamCapacity(busy, team.maxParallelWriters)}>
        <span className="flex items-center gap-1" aria-hidden>
          {Array.from({ length: team.maxParallelWriters }, (_, index) => (
            <span key={index} className={cn("h-3 w-1.5 rounded-full", index < busy ? "bg-brand" : "bg-muted")} />
          ))}
        </span>
        <span className="text-[11px] text-muted-foreground">{copy.teamCapacity(busy, team.maxParallelWriters)}</span>
      </div>
    </section>
  );
}
