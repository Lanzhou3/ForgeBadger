"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addFleetTask, fleetKeys, messageFleet, updateFleet } from "@/lib/fleet-api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useFleetCopy } from "./fleet-copy";

/** Paths separated by commas or new lines, blanks dropped, duplicates collapsed. */
export function parseFileScope(raw: string): string[] {
  return [...new Set(raw.split(/[\n,]/u).map((entry) => entry.trim()).filter(Boolean))];
}

/** One line to the flagship; it is queued as an owner message and read on the flagship's next run. */
export function MessageFlagshipBox({ fleetId, disabled }: { fleetId: string; disabled?: boolean }) {
  const copy = useFleetCopy();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const mutation = useMutation({
    mutationFn: (value: string) => messageFleet(fleetId, value),
    onSuccess: () => {
      setText("");
      toast.success(copy.messageSent);
      void queryClient.invalidateQueries({ queryKey: fleetKeys.detail(fleetId) });
    },
  });
  const send = () => {
    const value = text.trim();
    if (value && !mutation.isPending) mutation.mutate(value);
  };
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={copy.messagePlaceholder}
          aria-label={copy.messageTitle}
          disabled={disabled}
          maxLength={4000}
        />
        <Button type="submit" size="sm" disabled={disabled || mutation.isPending || !text.trim()}>
          <Send className="size-4" />{copy.messageSend}
        </Button>
      </div>
      {mutation.isError ? <p role="alert" className="text-xs text-destructive">{copy.messageFailed}</p> : null}
    </form>
  );
}

export function AddTaskDialog({ fleetId }: { fleetId: string }) {
  const copy = useFleetCopy();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [verifyCommand, setVerifyCommand] = useState("");
  const [fileScope, setFileScope] = useState("");
  const [details, setDetails] = useState("");
  const mutation = useMutation({
    mutationFn: () => {
      const scope = parseFileScope(fileScope);
      return addFleetTask(fleetId, {
        description: description.trim(),
        ...(verifyCommand.trim() ? { verifyCommand: verifyCommand.trim() } : {}),
        ...(scope.length > 0 ? { fileScope: scope } : {}),
        ...(details.trim() ? { details: details.trim() } : {}),
      });
    },
    onSuccess: () => {
      setOpen(false);
      setDescription("");
      setVerifyCommand("");
      setFileScope("");
      setDetails("");
      void queryClient.invalidateQueries({ queryKey: fleetKeys.all });
    },
  });
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />{copy.addTask}
      </Button>
      <Dialog open={open} onOpenChange={(next) => { if (!mutation.isPending) setOpen(next); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">{copy.addTaskTitle}</DialogTitle>
            <DialogDescription>{copy.addTaskDescription}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="fleet-task-description">{copy.taskDescription}</Label>
              <Textarea id="fleet-task-description" rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
              <p className="text-xs text-muted-foreground">{copy.taskDescriptionHint}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fleet-task-verify">{copy.taskVerify}</Label>
              <Input id="fleet-task-verify" className="font-mono text-xs" value={verifyCommand} onChange={(event) => setVerifyCommand(event.target.value)} />
              <p className="text-xs text-muted-foreground">{copy.taskVerifyHint}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fleet-task-scope">{copy.taskFileScope}</Label>
              <Textarea id="fleet-task-scope" rows={2} className="font-mono text-xs" value={fileScope} onChange={(event) => setFileScope(event.target.value)} />
              <p className="text-xs text-muted-foreground">{copy.taskFileScopeHint}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fleet-task-details">{copy.taskDetails}</Label>
              <Textarea id="fleet-task-details" rows={3} value={details} onChange={(event) => setDetails(event.target.value)} />
              <p className="text-xs text-muted-foreground">{copy.taskDetailsHint}</p>
            </div>
            {mutation.isError ? <p role="alert" className="text-sm text-destructive">{copy.addTaskFailed}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>{copy.cancel}</Button>
            <Button disabled={mutation.isPending || !description.trim()} onClick={() => mutation.mutate()}>
              {mutation.isPending ? copy.loading : copy.addTaskSubmit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The fleet's standing instructions: collapsed to a one-line summary, edited in place. */
export function InstructionsCard({ fleetId, instructions }: { fleetId: string; instructions: string }) {
  const copy = useFleetCopy();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(instructions);
  const dirty = draft !== instructions;
  // Follow the server copy unless the owner has edited past what we last saw.
  const seen = useRef(instructions);
  useEffect(() => {
    setDraft((current) => (current === seen.current ? instructions : current));
    seen.current = instructions;
  }, [instructions]);
  const mutation = useMutation({
    mutationFn: () => updateFleet(fleetId, { instructions: draft }),
    onSuccess: () => {
      toast.success(copy.instructionsSaved);
      void queryClient.invalidateQueries({ queryKey: fleetKeys.detail(fleetId) });
    },
  });
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section aria-label={copy.instructionsTitle} className="rounded-lg border border-border bg-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-lg px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <Chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold">{copy.instructionsTitle}</h2>
        {open ? null : (
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{instructions.trim() ? instructions.trim().split("\n")[0] : copy.instructionsEmpty}</span>
        )}
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border/70 px-4 py-3">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={6}
            placeholder={copy.instructionsPlaceholder}
            aria-label={copy.instructionsTitle}
          />
          {mutation.isError ? <p role="alert" className="text-sm text-destructive">{copy.instructionsFailed}</p> : null}
          <div className="flex items-center justify-end gap-3">
            <span className={cn("text-xs text-muted-foreground", !dirty && "invisible")}>{copy.instructionsDirty}</span>
            <Button size="sm" disabled={!dirty || mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? copy.loading : copy.instructionsSave}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
