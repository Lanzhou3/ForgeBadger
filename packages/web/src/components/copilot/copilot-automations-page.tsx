"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, Play, Plus, RefreshCw, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  type CopilotAutomationSuggestion,
} from "@/lib/copilot-api";

const automationsQueryKey = ["copilot", "automations"] as const;
const suggestionsQueryKey = ["copilot", "automation-suggestions"] as const;

export function CopilotAutomationsPage() {
  const { t } = useLanguage();
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
    onError: (err) => setError(err instanceof Error ? err.message : t("copilot.automationsCreateFailed"))
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAutomation,
    onSuccess: invalidate
  });

  const pauseMutation = useMutation({
    mutationFn: pauseAutomation,
    onSuccess: invalidate
  });

  const enableMutation = useMutation({
    mutationFn: enableAutomation,
    onSuccess: invalidate
  });

  const runMutation = useMutation({
    mutationFn: runAutomationNow,
    onSuccess: invalidate
  });

  const acceptMutation = useMutation({
    mutationFn: acceptAutomationSuggestion,
    onSuccess: invalidate
  });

  const dismissMutation = useMutation({
    mutationFn: dismissAutomationSuggestion,
    onSuccess: invalidate
  });

  const items = automations.data?.automations ?? [];
  const suggestionsList = suggestions.data?.suggestions ?? [];

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" asChild aria-label={t("copilot.settingsBack")}>
          <Link href="/copilot"><ArrowLeft className="size-4" /></Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{t("copilot.automationsTitle")}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("copilot.automationsDescription")}</p>
        </div>
      </div>

      {suggestionsList.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("copilot.automationsSuggestions")}</CardTitle>
          </CardHeader>
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm">{t("copilot.automationsList")}</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setCreating((v) => !v)}>
            {creating ? t("common.cancel") : <><Plus className="size-4" />{t("copilot.automationsCreate")}</>}
          </Button>
        </CardHeader>
        {creating && (
          <CardContent className="space-y-3 border-t border-border/70 pt-3">
            <div className="space-y-2">
              <Label htmlFor="automation-name">{t("common.name")}</Label>
              <input
                id="automation-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="automation-prompt">{t("copilot.automationsPrompt")}</Label>
              <Textarea
                id="automation-prompt"
                value={form.prompt}
                onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
                rows={3}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="automation-kind">{t("copilot.automationsSchedule")}</Label>
                <select
                  id="automation-kind"
                  value={form.scheduleKind}
                  onChange={(e) => setForm((f) => ({ ...f, scheduleKind: e.target.value as typeof form.scheduleKind }))}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <option value="cron">cron</option>
                  <option value="interval">interval</option>
                  <option value="once">once</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="automation-expression">{t("copilot.automationsExpression")}</Label>
                <input
                  id="automation-expression"
                  value={form.scheduleExpression}
                  onChange={(e) => setForm((f) => ({ ...f, scheduleExpression: e.target.value }))}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button size="sm" onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.name.trim() || !form.prompt.trim()}>
              {createMutation.isPending ? t("common.loading") : t("copilot.automationsSave")}
            </Button>
          </CardContent>
        )}
        <CardContent className="space-y-2">
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("copilot.automationsEmpty")}</p>
          ) : (
            items.map((automation) => (
              <AutomationRow
                key={automation.id}
                automation={automation}
                pending={pauseMutation.isPending || enableMutation.isPending || runMutation.isPending}
                onToggle={() => automation.status === "enabled" ? pauseMutation.mutate(automation.id) : enableMutation.mutate(automation.id)}
                onRun={() => runMutation.mutate(automation.id)}
                onDelete={() => {
                  if (window.confirm(t("copilot.automationsDeleteConfirm"))) deleteMutation.mutate(automation.id);
                }}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AutomationRow({ automation, pending, onToggle, onRun, onDelete }: {
  automation: CopilotAutomation;
  pending: boolean;
  onToggle: () => void;
  onRun: () => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex items-center gap-3 rounded-md border border-border/70 bg-card px-3 py-2">
      <CalendarClock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          {automation.name}
          <StatusBadge status={automation.status} />
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {automation.scheduleKind} {automation.scheduleExpression}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="icon" aria-label={t("copilot.automationsRunNow")} title={t("copilot.automationsRunNow")} disabled={pending} onClick={onRun}>
          <Play className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label={automation.status === "enabled" ? t("copilot.automationsPause") : t("copilot.automationsEnable")} disabled={pending} onClick={onToggle}>
          <RefreshCw className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" className="text-destructive" aria-label={t("common.delete")} disabled={pending} onClick={onDelete}>
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: CopilotAutomation["status"] }) {
  return (
    <Badge variant="outline" className="gap-1 text-[10px]">
      <span className={`size-1.5 rounded-full ${status === "enabled" ? "bg-emerald-400" : status === "paused" ? "bg-amber-400" : "bg-muted-foreground/40"}`} />
      {status}
    </Badge>
  );
}

function SuggestionRow({ suggestion, pending, onAccept, onDismiss }: {
  suggestion: CopilotAutomationSuggestion;
  pending: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const { t } = useLanguage();
  const spec = parseJobSpec(suggestion.jobSpec);
  return (
    <div className="flex items-center gap-3 rounded-md border border-border/70 bg-card px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{spec.name}</p>
        <p className="truncate text-xs text-muted-foreground">{spec.prompt}</p>
      </div>
      <Button size="sm" variant="outline" disabled={pending} onClick={onAccept}>{t("copilot.automationsAccept")}</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={onDismiss}>{t("copilot.automationsDismiss")}</Button>
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
