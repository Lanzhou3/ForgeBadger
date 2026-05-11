"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Clock3, Play, RefreshCcw, Sparkles, Square } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/hooks/use-language";
import {
  cancelCopilotRun,
  createCopilotRun,
  getCopilotCapabilities,
  listCopilotRuns,
  type CopilotRun,
  type CopilotRunEvent,
} from "@/lib/api";
import { getCopilotEventLabel, getCopilotStatusTone } from "@/lib/copilot";

interface ActiveRunState {
  run: CopilotRun;
  events: CopilotRunEvent[];
}

export default function CopilotPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [activeRun, setActiveRun] = useState<ActiveRunState | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const { data: capabilityData, isLoading: capabilitiesLoading } = useQuery({
    queryKey: ["copilot-capabilities"],
    queryFn: getCopilotCapabilities,
  });
  const { data: runData, isLoading: runsLoading } = useQuery({
    queryKey: ["copilot-runs"],
    queryFn: () => listCopilotRuns(20),
  });

  const runs = runData?.runs ?? [];
  const latestRun = activeRun?.run ?? runs[0] ?? null;
  const timelineEvents = activeRun?.events ?? [];
  const promptReady = prompt.trim().length > 0;
  const providerSetupError = isProviderSetupError(errorMessage);

  const statusSummary = useMemo(() => {
    const capabilities = capabilityData;
    if (!capabilities) return "OpenAI / Anthropic";
    return capabilities.supportedProviderFormats.join(" / ");
  }, [capabilityData]);

  const createMutation = useMutation({
    mutationFn: (value: string) => createCopilotRun({ prompt: value.trim(), source: "copilot" }),
    onSuccess: (result) => {
      setPrompt("");
      setErrorMessage("");
      setActiveRun(result);
      queryClient.invalidateQueries({ queryKey: ["copilot-runs"] });
    },
    onError: (error) => setErrorMessage(readErrorMessage(error)),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelCopilotRun(id),
    onSuccess: (result) => {
      setErrorMessage("");
      setActiveRun(result);
      queryClient.invalidateQueries({ queryKey: ["copilot-runs"] });
    },
    onError: (error) => setErrorMessage(readErrorMessage(error)),
  });

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{t("copilot.title")}</h1>
            <Badge variant="secondary">{capabilitiesLoading ? "..." : statusSummary}</Badge>
          </div>
          <p className="mt-1 max-w-3xl text-muted-foreground">{t("copilot.subtitle")}</p>
        </div>
        <Button
          variant="outline"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["copilot-runs"] })}
        >
          <RefreshCcw className="mr-2 size-4" />
          {t("copilot.refresh")}
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-brand" />
                <CardTitle>{t("copilot.title")}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <textarea
                className="min-h-[132px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                value={prompt}
                placeholder={t("copilot.promptPlaceholder")}
                onChange={(event) => setPrompt(event.target.value)}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                  {providerSetupError ? t("copilot.providerSetupRequired") : statusSummary}
                </div>
                <div className="flex items-center gap-2">
                  {latestRun?.status === "running" && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={cancelMutation.isPending}
                      onClick={() => cancelMutation.mutate(latestRun.id)}
                    >
                      <Square className="mr-2 size-4" />
                      {t("copilot.stop")}
                    </Button>
                  )}
                  <Button
                    type="button"
                    disabled={!promptReady || createMutation.isPending}
                    onClick={() => createMutation.mutate(prompt)}
                  >
                    <Play className="mr-2 size-4" />
                    {createMutation.isPending ? t("common.loading") : t("copilot.start")}
                  </Button>
                </div>
              </div>
              {errorMessage && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  <span>{providerSetupError ? t("copilot.providerSetupRequired") : errorMessage}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>{latestRun ? latestRun.goal : t("copilot.runs")}</CardTitle>
                {latestRun && <StatusBadge status={latestRun.status} />}
              </div>
            </CardHeader>
            <CardContent>
              {latestRun ? (
                <RunTimeline events={timelineEvents} noEventsLabel={t("copilot.noEvents")} />
              ) : (
                <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
                  {runsLoading ? t("common.loading") : t("copilot.noRuns")}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Clock3 className="size-4 text-muted-foreground" />
              <CardTitle>{t("copilot.runs")}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {runs.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                {runsLoading ? t("common.loading") : t("copilot.noRuns")}
              </div>
            ) : (
              runs.map((run) => (
                <div key={run.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate text-sm font-medium">{run.goal}</div>
                    <StatusBadge status={run.status} />
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {run.source}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RunTimeline({ events, noEventsLabel }: { events: CopilotRunEvent[]; noEventsLabel: string }) {
  if (events.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
        {noEventsLabel}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((event) => (
        <div key={event.id} className="rounded-md border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>{getCopilotEventLabel(event.type)}</span>
            <span>#{event.sequence}</span>
          </div>
          {event.message && (
            <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
              {event.message}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = getCopilotStatusTone(status);
  const variant = tone === "danger" ? "destructive" : tone === "success" ? "default" : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Copilot request failed";
}

function isProviderSetupError(message: string): boolean {
  return message.includes("copilot_provider_not_configured") || message.includes("HTTP 400");
}
