"use client";

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Lightbulb, Play, Plus, Trash2 } from "lucide-react";

import { SettingsCardHeader } from "@/components/settings/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CopilotSettingsShell } from "./copilot-settings-shell";
import { CopilotEmptyState } from "./copilot-empty-state";
import { useAutomationsCopy } from "./automations-copy";
import { useLanguage } from "@/hooks/use-language";
import {
  acceptAutomationSuggestion,
  createAutomation,
  deleteAutomation,
  dismissAutomationSuggestion,
  enableAutomation,
  listAutomations,
  listAutomationSuggestions,
  pauseAutomation,
  runAutomationNow,
  type CopilotAutomation,
  type CopilotAutomationStatus,
  type CopilotAutomationSuggestion,
} from "@/lib/copilot-api";

const automationsQueryKey = ["copilot", "automations"] as const;
const suggestionsQueryKey = ["copilot", "automation-suggestions"] as const;

/** Basic five-field cron sanity check (minute hour day month weekday). */
function isValidCron(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  return fields.length === 5 && fields.every((field) => field.length > 0);
}

export function CopilotAutomationsPage() {
  const { t } = useLanguage();
  const copy = useAutomationsCopy();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", prompt: "", scheduleKind: "cron" as "cron" | "interval" | "once", scheduleExpression: "0 9 * * *" });
  const [error, setError] = useState<string | null>(null);

  const automations = useQuery({ queryKey: automationsQueryKey, queryFn: listAutomations });
  const suggestions = useQuery({ queryKey: suggestionsQueryKey, queryFn: listAutomationSuggestions });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: automationsQueryKey });
    void queryClient.invalidateQueries({ queryKey: suggestionsQueryKey });
  }, [queryClient]);

  const cronInvalid = form.scheduleKind === "cron" && !isValidCron(form.scheduleExpression);

  const createMutation = useMutation({
    mutationFn: () => createAutomation({
      name: form.name.trim(),
      prompt: form.prompt.trim(),
      scopeType: "global",
      scheduleKind: form.scheduleKind,
      scheduleExpression: form.scheduleExpression.trim()
    }),
    onSuccess: () => {
      setCreating(false);
      setForm({ name: "", prompt: "", scheduleKind: "cron", scheduleExpression: "0 9 * * *" });
      setError(null);
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : copy.createFailed)
  });

  const deleteMutation = useMutation({ mutationFn: deleteAutomation, onSuccess: invalidate });
  const pauseMutation = useMutation({ mutationFn: pauseAutomation, onSuccess: invalidate });
  const enableMutation = useMutation({ mutationFn: enableAutomation, onSuccess: invalidate });
  const runMutation = useMutation({ mutationFn: runAutomationNow, onSuccess: invalidate });
  const acceptMutation = useMutation({ mutationFn: acceptAutomationSuggestion, onSuccess: invalidate });
  const dismissMutation = useMutation({ mutationFn: dismissAutomationSuggestion, onSuccess: invalidate });

  const items = automations.data?.automations ?? [];
  const suggestionsList = suggestions.data?.suggestions ?? [];
  const actionError = [deleteMutation, pauseMutation, enableMutation, runMutation, acceptMutation, dismissMutation].find(mutation => mutation.isError)?.error;

  return (
    <CopilotSettingsShell active="automations" title={copy.title} description={copy.description}>
      <div className="flex flex-col gap-4">
        {actionError && <p role="alert" className="text-sm text-destructive">{t("copilot.actionFailed")}</p>}
        {suggestions.isError && <p role="alert" className="text-sm text-destructive">{t("copilot.loadError")}</p>}
        {suggestionsList.length > 0 && (
          <Card className="forgebadger-animate-in">
            <SettingsCardHeader
              icon={<Lightbulb className="size-4" />}
              title={copy.suggestions}
              description={copy.suggestionsDescription}
            />
            <CardContent className="space-y-2">
              {suggestionsList.map((suggestion) => (
                <SuggestionRow
                  key={suggestion.id}
                  suggestion={suggestion}
                  pending={acceptMutation.isPending || dismissMutation.isPending}
                  onAccept={() => acceptMutation.mutate(suggestion.id)}
                  onDismiss={() => dismissMutation.mutate(suggestion.id)}
                />
              ))}
            </CardContent>
          </Card>
        )}

        <Card className="forgebadger-animate-in">
          <SettingsCardHeader
            icon={<CalendarClock className="size-4" />}
            title={copy.list}
            description={copy.listDescription}
            action={
              <Button size="sm" variant="outline" onClick={() => setCreating((v) => !v)}>
                {creating ? t("common.cancel") : <><Plus className="size-4" />{copy.create}</>}
              </Button>
            }
          />
          {creating && (
            <CardContent className="space-y-3 border-t border-border/70 pt-3">
              <div className="space-y-2">
                <Label htmlFor="automation-name">{t("common.name")}</Label>
                <Input
                  id="automation-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="automation-prompt">{copy.prompt}</Label>
                <Textarea
                  id="automation-prompt"
                  value={form.prompt}
                  onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
                  rows={3}
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{copy.scheduleKind}</Label>
                  <Select
                    value={form.scheduleKind}
                    onValueChange={(value) => setForm((f) => ({ ...f, scheduleKind: value as typeof form.scheduleKind }))}
                  >
                    <SelectTrigger aria-label={copy.scheduleKind} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cron">cron</SelectItem>
                      <SelectItem value="interval">interval</SelectItem>
                      <SelectItem value="once">once</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="automation-expression">{copy.expression}</Label>
                  <Input
                    id="automation-expression"
                    value={form.scheduleExpression}
                    onChange={(e) => setForm((f) => ({ ...f, scheduleExpression: e.target.value }))}
                    className="font-mono"
                    aria-invalid={cronInvalid}
                  />
                  {cronInvalid && <p role="alert" className="text-xs text-destructive">{copy.invalidCron}</p>}
                </div>
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => createMutation.mutate()}
                  disabled={createMutation.isPending || !form.name.trim() || !form.prompt.trim() || cronInvalid}
                >
                  {createMutation.isPending ? t("common.loading") : copy.save}
                </Button>
              </div>
            </CardContent>
          )}
          <CardContent className="space-y-2">
            {automations.isPending ? (
              <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
            ) : automations.isError ? (
              <p role="alert" className="text-sm text-destructive">{t("copilot.loadError")}</p>
            ) : items.length === 0 ? (
              <CopilotEmptyState icon={CalendarClock} title={copy.empty} />
            ) : (
              items.map((automation) => (
                <AutomationRow
                  key={automation.id}
                  automation={automation}
                  pending={deleteMutation.isPending || pauseMutation.isPending || enableMutation.isPending || runMutation.isPending}
                  onToggle={(enabled) => enabled ? enableMutation.mutate(automation.id) : pauseMutation.mutate(automation.id)}
                  onRun={() => runMutation.mutate(automation.id)}
                  onDelete={() => deleteMutation.mutate(automation.id)}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </CopilotSettingsShell>
  );
}

function AutomationRow({ automation, pending, onToggle, onRun, onDelete }: {
  automation: CopilotAutomation;
  pending: boolean;
  onToggle: (enabled: boolean) => void;
  onRun: () => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const copy = useAutomationsCopy();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const enabled = automation.status === "enabled";
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border/70 bg-card px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span className="line-clamp-2 min-w-0 break-all" title={automation.name}>{automation.name}</span>
          <StatusBadge status={automation.status} />
        </p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {automation.scheduleKind} {automation.scheduleExpression}
        </p>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="icon" aria-label={copy.runNow} title={copy.runNow} disabled={pending} onClick={onRun}>
          <Play className="size-4" />
        </Button>
        <Switch
          aria-label={enabled ? copy.pause : copy.enable}
          checked={enabled}
          disabled={pending}
          onCheckedChange={onToggle}
        />
        <Button variant="ghost" size="icon" className="text-destructive" aria-label={t("common.delete")} disabled={pending} onClick={() => setDeleteOpen(true)}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.deleteConfirm}</DialogTitle>
            <DialogDescription>{automation.name}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>{t("common.cancel")}</Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                setDeleteOpen(false);
                onDelete();
              }}
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ status }: { status: CopilotAutomationStatus }) {
  const copy = useAutomationsCopy();
  const classes = status === "enabled"
    ? "bg-emerald-500/15 text-emerald-400"
    : status === "paused"
      ? "bg-amber-500/15 text-amber-400"
      : "text-muted-foreground";
  const label = status === "enabled" ? copy.statusEnabled : status === "paused" ? copy.statusPaused : copy.statusDraft;
  return <Badge variant="secondary" className={classes}>{label}</Badge>;
}

function SuggestionRow({ suggestion, pending, onAccept, onDismiss }: {
  suggestion: CopilotAutomationSuggestion;
  pending: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const copy = useAutomationsCopy();
  const raw = parseJobSpec(suggestion.jobSpec);
  // Catalog suggestions ship a stable dedupKey; localized card text comes from
  // the copy module, with the stored jobSpec as the fallback for unknown keys.
  const catalog = copy.catalogSuggestions[suggestion.dedupKey];
  const name = catalog?.name ?? raw.name;
  const prompt = catalog?.prompt ?? raw.prompt;
  return (
    <div className="flex items-center gap-3 rounded-md border border-border/70 bg-card px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="break-all text-sm font-medium">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{prompt}</p>
      </div>
      <Button size="sm" variant="outline" disabled={pending} onClick={onAccept}>{copy.accept}</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={onDismiss}>{copy.dismiss}</Button>
    </div>
  );
}

function parseJobSpec(jobSpec: string): { name: string; prompt: string } {
  try {
    const parsed = JSON.parse(jobSpec) as { name?: string; prompt?: string };
    return { name: parsed.name ?? "", prompt: parsed.prompt ?? "" };
  } catch {
    return { name: jobSpec, prompt: "" };
  }
}
