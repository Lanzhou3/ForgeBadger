"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, KanbanSquare, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { CopilotGoalTeam } from "@/lib/copilot-api";
import { answerFleetTask, cancelFleetTask, fleetKeys } from "@/lib/fleet-api";
import { cn } from "@/lib/utils";
import { ReviewPanel, Track } from "../copilot/goal-task-flow";
import { MemberAvatar, memberHue } from "../copilot/goal-team-strip";
import type { FleetCardModel } from "./fleet-board-model";
import { taskSentence, useFleetCopy } from "./fleet-copy";

interface Props {
  fleetId: string;
  projectId: string;
  card: FleetCardModel | null;
  roster: CopilotGoalTeam | undefined;
  live: boolean;
  onClose: () => void;
}

/** One task in full: track, verification, workspace, review findings, the owner's answer box and cancel. */
export function FleetTaskDrawer({ fleetId, projectId, card, roster, live, onClose }: Props) {
  const copy = useFleetCopy();
  return (
    <Sheet open={card != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg" aria-describedby={undefined}>
        {card ? <DrawerBody key={card.task.id} fleetId={fleetId} projectId={projectId} card={card} roster={roster} live={live} /> : (
          <SheetHeader><SheetTitle>{copy.title}</SheetTitle></SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border/70 px-4 py-3">
      <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function DrawerBody({ fleetId, projectId, card, roster, live }: Omit<Props, "onClose"> & { card: FleetCardModel }) {
  const copy = useFleetCopy();
  const queryClient = useQueryClient();
  const { task, team, flow } = card;
  const [answer, setAnswer] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: fleetKeys.all });
  const answerMutation = useMutation({
    mutationFn: (text: string) => answerFleetTask(fleetId, task.id, text),
    onSuccess: () => { setAnswer(""); refresh(); },
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelFleetTask(fleetId, task.id),
    onSuccess: () => { setCancelOpen(false); refresh(); },
  });
  const sentence = taskSentence(copy, task, flow);
  const worker = team?.worker ?? null;
  const workerName = worker ? (worker.memberName ?? worker.adapter) : copy.workerFlagship;
  const verified = task.verifiedAt != null && task.verifyExitCode === 0;
  const attempts = team?.review?.attempts ?? [];
  const settled = task.status === "passes" || task.status === "cancelled";

  return (
    <>
      <SheetHeader className="gap-2 pr-10">
        <div className="flex items-center gap-2">
          <MemberAvatar name={workerName} hue={memberHue(roster, worker?.memberId ?? task.memberId)} busy={flow.holder === "member"} />
          <span className="font-mono text-xs text-muted-foreground">#{task.seq}</span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">{workerName}</span>
        </div>
        <SheetTitle className="whitespace-pre-wrap break-words text-base leading-snug">{task.description}</SheetTitle>
        <p className={cn("text-xs", card.held ? "font-medium text-brand-accent" : "text-muted-foreground")}>{sentence.text}</p>
      </SheetHeader>

      {card.held && task.hold ? (
        <section className="mx-4 mb-3 space-y-2 rounded-lg border border-brand-accent/50 bg-brand-accent/[0.05] p-3">
          <h3 className="text-sm font-semibold">{copy.heldTitle}</h3>
          <p className="whitespace-pre-wrap break-words rounded-md bg-card px-3 py-2 text-sm">{task.hold.question}</p>
          <Textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing && answer.trim()) {
                event.preventDefault();
                answerMutation.mutate(answer.trim());
              }
            }}
            placeholder={copy.answerPlaceholder}
            aria-label={copy.answerPlaceholder}
            rows={3}
          />
          {answerMutation.isError ? <p role="alert" className="text-sm text-destructive">{copy.answerFailed}</p> : null}
          <div className="flex justify-end">
            <Button size="sm" disabled={answerMutation.isPending || !answer.trim()} onClick={() => answerMutation.mutate(answer.trim())}>
              {answerMutation.isPending ? copy.loading : copy.answerSubmit}
            </Button>
          </div>
        </section>
      ) : null}

      <div className={cn("px-4 pb-3 pt-1", live && "fb-flow-live")}>
        <Track stages={flow.stages} rowIndex={0} />
      </div>

      <Section title={copy.verifyTitle}>
        {task.verifyCommand ? (
          <div className="space-y-1">
            <code className="block max-w-full truncate rounded bg-muted/40 px-1.5 py-1 font-mono text-[11px]" title={task.verifyCommand}>{task.verifyCommand}</code>
            <p className="text-xs text-muted-foreground">
              {verified ? copy.verified : task.verifiedAt != null && task.verifyExitCode != null ? copy.verifyFailedCode(task.verifyExitCode) : copy.unverified}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{copy.verifyNone}</p>
        )}
      </Section>

      <Section title={copy.workspaceTitle}>
        <p className="text-xs">
          {team?.workspace === "own" ? (team.integrated ? copy.workspaceOwnIntegrated : copy.workspaceOwnPending) : copy.workspaceShared}
        </p>
      </Section>

      {task.dispatchedSessionId || task.workItemId ? (
        <Section title={copy.sessionTitle}>
          <div className="flex flex-wrap items-center gap-1.5">
            {task.dispatchedSessionId ? (
              <Link
                href={`/sessions/${encodeURIComponent(task.dispatchedSessionId)}`}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-brand/10 hover:text-foreground"
              >
                <Send className="size-3" aria-hidden />
                {copy.openSession}
                {task.dispatchStatus ? ` (${copy.dispatchStatus[task.dispatchStatus] ?? task.dispatchStatus})` : ""}
              </Link>
            ) : null}
            {task.workItemId ? (
              <Link
                href={`/projects/${encodeURIComponent(projectId)}`}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-brand/10 hover:text-foreground"
              >
                <KanbanSquare className="size-3" aria-hidden />
                {copy.boardLink}
              </Link>
            ) : null}
          </div>
        </Section>
      ) : null}

      {attempts.length > 0 ? (
        <Section title={copy.reviewTitle}>
          <ReviewPanel attempts={attempts} roundsLeft={team?.review?.roundsLeft ?? 0} />
        </Section>
      ) : null}

      <Section title={copy.fileScopeTitle}>
        {task.fileScope.length > 0 ? (
          <ul className="flex flex-wrap gap-1">
            {task.fileScope.map((path) => (
              <li key={path} className="max-w-full truncate rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]" title={path}>{path}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">{copy.fileScopeAny}</p>
        )}
      </Section>

      {task.note ? <Section title={copy.noteTitle}><p className="whitespace-pre-wrap break-words text-xs">{task.note}</p></Section> : null}
      {task.details ? <Section title={copy.detailsTitle}><p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{task.details}</p></Section> : null}
      {task.status === "passes" && task.evidence ? (
        <Section title={copy.evidenceTitle}>
          <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground">{task.evidence}</pre>
        </Section>
      ) : null}

      {settled ? null : (
        <div className="mt-auto border-t border-border/70 px-4 py-3">
          {cancelMutation.isError ? <p role="alert" className="mb-2 text-sm text-destructive">{copy.cancelTaskFailed}</p> : null}
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelOpen(true)}>
            <Ban className="size-4" />{copy.cancelTask}
          </Button>
          <ConfirmDialog
            open={cancelOpen}
            title={copy.cancelTaskTitle(task.seq)}
            description={copy.cancelTaskBody}
            confirmLabel={copy.cancelTaskConfirm}
            destructive
            pending={cancelMutation.isPending}
            onOpenChange={setCancelOpen}
            onConfirm={() => cancelMutation.mutate()}
          />
        </div>
      )}
    </>
  );
}
