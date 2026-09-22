"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  createGrant,
  deleteGrant,
  getProjectOverview,
  listGrants,
  revokeGrant,
  type ManagedProject,
} from "@/lib/platform-actions-api";
import { useSettingsCopy } from "./settings-copy";

export interface CopilotGrantsPanelProps {
  onStartConversation: (grantId: string) => Promise<void>;
  boundGrantId?: string | null;
  startConversationLabel?: string;
  onGrantCreated?: (grantId: string) => void;
}

type Grant = Awaited<ReturnType<typeof listGrants>>["grants"][number];

/**
 * Grant management surface: list, create, revoke, and delete project grants.
 * Shared by the access settings page, the chat management Sheet, and the
 * channels binding step — each host supplies its own onStartConversation.
 */
export function CopilotGrantsPanel({
  onStartConversation,
  boundGrantId,
  startConversationLabel,
  onGrantCreated,
}: CopilotGrantsPanelProps) {
  const copy = useSettingsCopy();
  const client = useQueryClient();
  const grants = useQuery({
    queryKey: ["copilot-grants"],
    queryFn: listGrants,
    refetchInterval: 15000,
  });
  const overview = useQuery({
    queryKey: ["project-management-overview"],
    queryFn: () => getProjectOverview(),
    refetchInterval: 30000,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showRevoked, setShowRevoked] = useState(false);
  const [creating, setCreating] = useState(false);
  const revokedCount =
    grants.data?.grants.filter((grant) => grant.status === "revoked").length ?? 0;

  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await client.invalidateQueries({ queryKey: ["copilot-grants"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.errorGeneric);
    } finally {
      setBusy(false);
    }
  }

  const visible = grants.data?.grants.filter(
    (grant) => showRevoked || grant.status !== "revoked",
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 text-brand" />
            {copy.grantsTitle}
          </h2>
          <p className="text-xs text-muted-foreground">{copy.grantsDescription}</p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          {copy.newGrant}
        </Button>
      </div>
      {boundGrantId && (
        <p className="break-all rounded-md border border-brand/30 bg-brand/5 px-3 py-2 text-xs">
          {copy.boundPrefix}
          {grants.data?.grants.find((grant) => grant.id === boundGrantId)?.name ?? boundGrantId}
        </p>
      )}
      {grants.isPending && <p role="status" className="text-sm">{copy.loading}</p>}
      {grants.isError && (
        <p role="alert" className="text-sm">
          {copy.loadError}{" "}
          <Button variant="outline" size="sm" onClick={() => void grants.refetch()}>
            {copy.retry}
          </Button>
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {grants.data && visible && (
        <div className="space-y-3">
          {!grants.data.grants.length && (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/70 px-4 py-8 text-center">
              <KeyRound className="size-5 text-muted-foreground" />
              <p className="max-w-md text-xs text-muted-foreground">{copy.empty}</p>
            </div>
          )}
          {visible.map((grant) => (
            <GrantCard
              key={grant.id}
              grant={grant}
              projects={overview.data?.projects ?? []}
              busy={busy}
              startLabel={startConversationLabel ?? copy.startConversation}
              onStart={() => void perform(() => onStartConversation(grant.id))}
              onRevoke={() => void perform(() => revokeGrant(grant.id))}
              onDelete={() => void perform(() => deleteGrant(grant.id))}
            />
          ))}
          {revokedCount > 0 && (
            <div className="space-y-2">
              <Button variant="outline" size="sm" onClick={() => setShowRevoked((value) => !value)}>
                {showRevoked ? copy.hideRevoked : copy.showRevoked}（{revokedCount}）
              </Button>
              {showRevoked && (
                <p className="text-xs text-muted-foreground">{copy.revokedHelp}</p>
              )}
            </div>
          )}
        </div>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{copy.createTitle}</DialogTitle>
            <DialogDescription>{copy.createDescription}</DialogDescription>
          </DialogHeader>
          {creating && overview.data && grants.data && (
            <GrantForm
              projects={overview.data.projects}
              capabilities={grants.data.capabilities}
              busy={busy}
              onCreate={async (input) => {
                const result = await createGrant(input);
                await client.invalidateQueries({ queryKey: ["copilot-grants"] });
                onGrantCreated?.(result.grant.id);
              }}
            />
          )}
          {creating && (!overview.data || !grants.data) && (
            <p role="status" className="text-sm">
              {copy.loading}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function GrantCard({
  grant,
  projects,
  busy,
  startLabel,
  onStart,
  onRevoke,
  onDelete,
}: {
  grant: Grant;
  projects: ManagedProject[];
  busy: boolean;
  startLabel: string;
  onStart: () => void;
  onRevoke: () => void;
  onDelete: () => void;
}) {
  const copy = useSettingsCopy();
  const expired = grant.expiresAt !== null && grant.expiresAt <= Date.now();
  const usable =
    grant.status === "active" &&
    !expired &&
    (grant.maxActions === null || grant.usedActions < grant.maxActions);
  const status = grant.status === "revoked" ? "revoked" : expired ? "expired" : "active";
  const statusLabel =
    status === "revoked"
      ? copy.statusRevoked
      : status === "expired"
        ? copy.statusExpired
        : copy.statusActive;
  const statusClass =
    status === "active"
      ? "border-emerald-500/50 text-emerald-500"
      : status === "expired"
        ? "border-amber-500/50 text-amber-500"
        : "text-muted-foreground";
  const usageRatio =
    grant.maxActions === null ? null : Math.min(1, grant.usedActions / grant.maxActions);
  const projectNames =
    grant.scope.projectIds
      .map((id) => projects.find((project) => project.id === id)?.name ?? id)
      .join("、") || copy.projectsEmpty;
  const capabilityNames = grant.scope.capabilities
    .map((id) => copy.capabilities[id] ?? id)
    .join("、");

  return (
    <div className="forgebadger-animate-in space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-medium break-all">{grant.name}</p>
          <p className="text-xs break-all text-muted-foreground">
            {projectNames} · {capabilityNames}
          </p>
        </div>
        <Badge variant="outline" className={`shrink-0 ${statusClass}`}>
          {statusLabel}
        </Badge>
      </div>
      {usageRatio !== null && (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="presentation"
        >
          <div
            className="h-full rounded-full bg-brand transition-[width]"
            style={{ width: `${usageRatio * 100}%` }}
          />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {copy.usageActions} {grant.usedActions}/{grant.maxActions ?? copy.unlimited} ·{" "}
        {copy.concurrency} {grant.maxConcurrency} · {copy.expiry}{" "}
        {grant.expiresAt === null
          ? copy.permanent
          : new Date(grant.expiresAt).toLocaleString()}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !usable} onClick={onStart}>
          {startLabel}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || grant.status !== "active"}
          onClick={onRevoke}
        >
          {copy.revoke}
        </Button>
        {grant.status === "revoked" && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={busy}
            onClick={onDelete}
          >
            {copy.deleteGrant}
          </Button>
        )}
      </div>
    </div>
  );
}

function GrantForm({
  projects,
  capabilities,
  busy,
  onCreate,
}: {
  projects: ManagedProject[];
  capabilities: { capability: string }[];
  busy: boolean;
  onCreate: (input: Parameters<typeof createGrant>[0]) => Promise<void>;
}) {
  const copy = useSettingsCopy();
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [allOperations, setAllOperations] = useState(true);
  const [actions, setActions] = useState<string[]>([]);
  const [permanent, setPermanent] = useState(true);
  const [unlimited, setUnlimited] = useState(true);
  const [hours, setHours] = useState(24);
  const [limit, setLimit] = useState(20);
  const [concurrency, setConcurrency] = useState(1);
  const [roots, setRoots] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const inFlight = useRef(false);
  const toggle = (value: string, values: string[], update: (next: string[]) => void) =>
    update(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || busy) return;
    setFeedback(null);
    const allowedRoots = roots.split("\n").map((line) => line.trim()).filter(Boolean);
    const fail = (text: string) => setFeedback({ error: true, text });
    if (!selected.length) return fail(copy.errNoProject);
    if (!allOperations && !actions.length) return fail(copy.errNoOperation);
    if (!allOperations && actions.includes("project.create") && !allowedRoots.length)
      return fail(copy.errNoRoots);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20)
      return fail(copy.errConcurrency);
    if (!permanent && (!Number.isInteger(hours) || hours < 1 || hours > 8760))
      return fail(copy.errHours);
    if (!unlimited && (!Number.isInteger(limit) || limit < 1 || limit > 10000))
      return fail(copy.errLimit);
    inFlight.current = true;
    setSubmitting(true);
    try {
      await onCreate({
        name:
          name.trim() ||
          `${projects
            .filter((project) => selected.includes(project.id))
            .map((project) => project.name)
            .join("、")}授权`.slice(0, 200),
        projectIds: selected,
        ...(allOperations ? { allOperations: true } : { capabilities: actions, allowedRoots }),
        expiresAt: permanent ? null : Date.now() + hours * 3600000,
        maxActions: unlimited ? null : limit,
        maxConcurrency: concurrency,
      });
      setFeedback({ error: false, text: copy.created });
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : copy.errCreate);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form noValidate className="space-y-5" onSubmit={submit}>
      <fieldset disabled={submitting || busy} className="space-y-2">
        <legend className="text-sm font-medium">
          <span className="mr-2 inline-flex size-5 items-center justify-center rounded-full bg-brand/15 text-[11px] font-semibold text-brand">1</span>
          {copy.stepProjects}
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {projects.map((project) => (
            <label
              key={project.id}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-sm transition-colors hover:border-border hover:bg-muted/50"
            >
              <input
                type="checkbox"
                checked={selected.includes(project.id)}
                onChange={() => toggle(project.id, selected, setSelected)}
              />
              {project.name}
            </label>
          ))}
        </div>
        <label className="block space-y-1 pt-1 text-sm">
          <span className="text-xs text-muted-foreground">{copy.nameLabel}</span>
          <Input
            maxLength={200}
            value={name}
            placeholder={copy.namePlaceholder}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      </fieldset>
      <fieldset disabled={submitting || busy} className="space-y-2">
        <legend className="text-sm font-medium">
          <span className="mr-2 inline-flex size-5 items-center justify-center rounded-full bg-brand/15 text-[11px] font-semibold text-brand">2</span>
          {copy.stepPermissions}
        </legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allOperations}
            onChange={(event) => setAllOperations(event.target.checked)}
          />
          {copy.allOperations}
        </label>
        <p className="text-xs text-muted-foreground">
          {allOperations ? copy.allOperationsHelp : copy.customOperationsHelp}
        </p>
        {!allOperations && (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {[...new Set(capabilities.map((item) => item.capability))].map((id) => (
                <label key={id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={actions.includes(id)}
                    onChange={() => toggle(id, actions, setActions)}
                  />
                  <span>{copy.capabilities[id] ?? id}</span>
                </label>
              ))}
            </div>
            {actions.includes("project.create") && (
              <label className="block space-y-1 text-sm">
                <span className="text-xs text-muted-foreground">{copy.allowedRootsLabel}</span>
                <textarea
                  className="w-full rounded-md border border-border bg-background p-2"
                  value={roots}
                  onChange={(event) => setRoots(event.target.value)}
                />
              </label>
            )}
          </>
        )}
      </fieldset>
      <fieldset disabled={submitting || busy} className="space-y-3">
        <legend className="text-sm font-medium">
          <span className="mr-2 inline-flex size-5 items-center justify-center rounded-full bg-brand/15 text-[11px] font-semibold text-brand">3</span>
          {copy.stepLimits}
        </legend>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={permanent}
              onChange={(event) => setPermanent(event.target.checked)}
            />
            {copy.permanentLabel}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={unlimited}
              onChange={(event) => setUnlimited(event.target.checked)}
            />
            {copy.unlimitedLabel}
          </label>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <label className="space-y-1">
            <span className="text-muted-foreground">{copy.hoursLabel}</span>
            <Input
              type="number"
              min={1}
              max={8760}
              disabled={permanent}
              value={hours}
              onChange={(event) => setHours(Number(event.target.value))}
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground">{copy.limitLabel}</span>
            <Input
              type="number"
              min={1}
              max={10000}
              disabled={unlimited}
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground">{copy.concurrencyLabel}</span>
            <Input
              type="number"
              min={1}
              max={20}
              value={concurrency}
              onChange={(event) => setConcurrency(Number(event.target.value))}
            />
          </label>
        </div>
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy || submitting}>
          {submitting ? copy.creating : copy.create}
        </Button>
        {feedback && (
          <p
            role={feedback.error ? "alert" : "status"}
            className={`text-xs ${feedback.error ? "text-destructive" : "text-muted-foreground"}`}
          >
            {feedback.text}
          </p>
        )}
      </div>
    </form>
  );
}
