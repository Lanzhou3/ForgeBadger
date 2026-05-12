"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { CircleAlert, Clock3, Play, RefreshCcw, Sparkles, Square } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/hooks/use-language";
import {
  approveCopilotPendingAction,
  cancelCopilotRun,
  createCopilotRun,
  GatewayApiError,
  getCopilotCapabilities,
  getCopilotRun,
  listModelProviders,
  listCopilotRuns,
  rejectCopilotPendingAction,
  type CopilotPendingActionDecision,
  type CopilotPendingAction,
  type CopilotRun,
  type CopilotRunEvent,
  type ModelProfile,
} from "@/lib/api";
import {
  findCurrentLiveCopilotRun,
  getCopilotLaunchPromptKey,
  getCopilotEventLabel,
  getCopilotEventLabelKey,
  getCopilotErrorMessageKey,
  getCopilotPendingActionLabel,
  getCopilotPendingActionLabelKey,
  getCopilotPendingActionSummary,
  getSelectableCopilotProviders,
  getCopilotStartBlocker,
  getCopilotStatusTone,
  isCopilotRunLive,
  resolveCopilotLaunchContext,
  resolveCopilotRunSelection,
} from "@/lib/copilot";
import type { TranslationKey } from "@/lib/i18n";

const starterPrompts: Array<{ labelKey: TranslationKey; promptKey: TranslationKey }> = [
  {
    labelKey: "copilot.starter.launchReadiness",
    promptKey: "copilot.starter.launchReadinessPrompt",
  },
  {
    labelKey: "copilot.starter.releaseGates",
    promptKey: "copilot.starter.releaseGatesPrompt",
  },
  {
    labelKey: "copilot.starter.providerSetup",
    promptKey: "copilot.starter.providerSetupPrompt",
  },
];

interface ActiveRunState {
  run: CopilotRun;
  events: CopilotRunEvent[];
  pendingActions?: CopilotPendingAction[];
}

export default function CopilotPage() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [activeRun, setActiveRun] = useState<ActiveRunState | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedModelProfileId, setSelectedModelProfileId] = useState("");
  const [processingActionId, setProcessingActionId] = useState<string | null>(null);
  const processingActionIdRef = useRef<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const appliedLaunchPromptRef = useRef<string | null>(null);
  const launchContext = useMemo(() => resolveCopilotLaunchContext(searchParams), [searchParams]);
  const launchPromptKey = getCopilotLaunchPromptKey(launchContext.intent);
  const launchPrompt = launchPromptKey ? t(launchPromptKey) : "";

  useEffect(() => {
    if (!launchPrompt || appliedLaunchPromptRef.current === launchPrompt) return;
    setPrompt((current) => (current.trim() ? current : launchPrompt));
    appliedLaunchPromptRef.current = launchPrompt;
  }, [launchPrompt]);

  const {
    data: capabilityData,
    isLoading: capabilitiesLoading,
    isError: capabilitiesLoadFailed,
    error: capabilitiesError,
    refetch: refetchCapabilities,
  } = useQuery({
    queryKey: ["copilot-capabilities"],
    queryFn: getCopilotCapabilities,
    retry: false,
  });
  const {
    data: modelProviderData,
    isLoading: modelProvidersLoading,
    isError: modelProvidersLoadFailed,
    error: modelProvidersError,
    refetch: refetchModelProviders,
  } = useQuery({
    queryKey: ["model-providers"],
    queryFn: listModelProviders,
    retry: false,
  });
  const {
    data: runData,
    isLoading: runsLoading,
    isError: runsLoadFailed,
    error: runsError,
    refetch: refetchRuns,
  } = useQuery({
    queryKey: ["copilot-runs"],
    queryFn: () => listCopilotRuns(20),
    retry: false,
  });

  const runs = runData?.runs ?? [];
  const resolvedRunId = resolveCopilotRunSelection({
    selectedRunId,
    activeRunId: activeRun?.run.id,
    runs,
  });
  const {
    data: selectedRunData,
    isFetching: selectedRunLoading,
    isError: selectedRunLoadFailed,
    error: selectedRunError,
    refetch: refetchSelectedRun,
  } = useQuery({
    queryKey: ["copilot-run", resolvedRunId],
    queryFn: () => getCopilotRun(resolvedRunId as string),
    enabled: Boolean(resolvedRunId),
    retry: false,
    refetchInterval: (query) =>
      isCopilotRunLive(query.state.data?.run?.status ?? "") ? 4_000 : false,
  });
  const selectedRunState =
    (selectedRunData?.run ? selectedRunData : null) ??
    (activeRun && activeRun.run.id === resolvedRunId ? activeRun : null);
  const latestRun = selectedRunState?.run ?? runs.find((run) => run.id === resolvedRunId) ?? runs[0] ?? null;
  const timelineEvents = selectedRunState?.events ?? [];
  const pendingActions = selectedRunState?.pendingActions ?? [];
  const liveRun = findCurrentLiveCopilotRun({
    activeRun: activeRun?.run ?? null,
    selectedRun: selectedRunData?.run ?? null,
    runs,
  });
  const liveRunActive = Boolean(liveRun);
  const promptReady = prompt.trim().length > 0;
  const providerSetupError = isProviderSetupError(errorCode);
  const providerConfigured = capabilityData?.providerConfigured !== false;
  const supportedProviderFormats = useMemo(
    () => capabilityData?.supportedProviderFormats ?? ["openai", "openai-compatible", "anthropic"],
    [capabilityData]
  );
  const copilotProviders = useMemo(
    () =>
      getSelectableCopilotProviders({
        providers: modelProviderData?.providers ?? [],
        credentials: modelProviderData?.credentials ?? [],
        models: modelProviderData?.models ?? [],
        supportedProviderFormats,
      }),
    [
      modelProviderData?.credentials,
      modelProviderData?.models,
      modelProviderData?.providers,
      supportedProviderFormats,
    ]
  );
  const providerModels = useMemo(
    () =>
      (modelProviderData?.models ?? []).filter((model) =>
        model.providerProfileId === selectedProviderId && isSelectableCopilotModel(model)
      ),
    [modelProviderData?.models, selectedProviderId]
  );
  const providerSelectionUnavailable =
    !modelProvidersLoading &&
    !modelProvidersLoadFailed &&
    (copilotProviders.length === 0 || (copilotProviders.length > 0 && providerModels.length === 0));
  const providerSetupRequired = !providerConfigured || providerSetupError || providerSelectionUnavailable;

  useEffect(() => {
    setSelectedProviderId((current) =>
      copilotProviders.some((provider) => provider.id === current) ? current : copilotProviders[0]?.id ?? ""
    );
  }, [copilotProviders]);

  useEffect(() => {
    setSelectedModelProfileId((current) => {
      if (providerModels.some((model) => model.id === current)) return current;
      return providerModels.find((model) => model.isDefault)?.id ?? providerModels[0]?.id ?? "";
    });
  }, [providerModels]);
  const modelSelectionReady = Boolean(selectedProviderId && selectedModelProfileId);

  const statusSummary = useMemo(() => {
    const capabilities = capabilityData;
    if (!capabilities) return "OpenAI / Anthropic";
    return capabilities.supportedProviderFormats.join(" / ");
  }, [capabilityData]);

  const createMutation = useMutation({
    mutationFn: (value: string) => createCopilotRun({
      prompt: value.trim(),
      source: launchContext.source,
      ...(launchContext.sourceRefId ? { sourceRefId: launchContext.sourceRefId } : {}),
      ...(selectedProviderId ? { providerProfileId: selectedProviderId } : {}),
      ...(selectedModelProfileId ? { modelProfileId: selectedModelProfileId } : {}),
    }),
    onSuccess: (result) => {
      setPrompt("");
      clearErrorState(setErrorMessage, setErrorCode);
      setActiveRun(result);
      setSelectedRunId(result.run.id);
      queryClient.invalidateQueries({ queryKey: ["copilot-runs"] });
      queryClient.invalidateQueries({ queryKey: ["copilot-run", result.run.id] });
    },
    onError: (error) => applyErrorState(error, setErrorMessage, setErrorCode),
  });
  const startBlocker = getCopilotStartBlocker({
    promptReady,
    providerConfigured,
    modelSelectionReady,
    modelProvidersLoading,
    modelProvidersLoadFailed,
    createPending: createMutation.isPending,
    liveRunStatus: liveRun?.status ?? null,
  });
  const canStartCopilotRun = startBlocker === null;

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelCopilotRun(id),
    onSuccess: (result) => {
      clearErrorState(setErrorMessage, setErrorCode);
      setActiveRun(result);
      setSelectedRunId(result.run.id);
      queryClient.invalidateQueries({ queryKey: ["copilot-runs"] });
      queryClient.invalidateQueries({ queryKey: ["copilot-run", result.run.id] });
    },
    onError: (error) => applyErrorState(error, setErrorMessage, setErrorCode),
  });

  const approveMutation = useMutation({
    mutationFn: (action: CopilotPendingAction) => approveCopilotPendingAction(action.runId, action.id),
    onSuccess: (result) => {
      clearErrorState(setErrorMessage, setErrorCode);
      applyPendingActionResult(result, setActiveRun);
      cachePendingActionResult(result, queryClient);
      queryClient.invalidateQueries({ queryKey: ["copilot-run", result.action.runId] });
      queryClient.invalidateQueries({ queryKey: ["copilot-runs"] });
    },
    onError: (error) => applyErrorState(error, setErrorMessage, setErrorCode),
    onSettled: () => clearProcessingAction(processingActionIdRef, setProcessingActionId),
  });

  const rejectMutation = useMutation({
    mutationFn: (action: CopilotPendingAction) => rejectCopilotPendingAction(action.runId, action.id),
    onSuccess: (result) => {
      clearErrorState(setErrorMessage, setErrorCode);
      applyPendingActionResult(result, setActiveRun);
      cachePendingActionResult(result, queryClient);
      queryClient.invalidateQueries({ queryKey: ["copilot-run", result.action.runId] });
      queryClient.invalidateQueries({ queryKey: ["copilot-runs"] });
    },
    onError: (error) => applyErrorState(error, setErrorMessage, setErrorCode),
    onSettled: () => clearProcessingAction(processingActionIdRef, setProcessingActionId),
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
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["copilot-runs"] });
            if (resolvedRunId) {
              queryClient.invalidateQueries({ queryKey: ["copilot-run", resolvedRunId] });
            }
          }}
        >
          <RefreshCcw className="mr-2 size-4" />
          {t("copilot.refresh")}
        </Button>
      </div>

      <div className="space-y-2">
        {capabilitiesLoadFailed && (
          <QueryErrorNotice
            title={t("copilot.capabilitiesLoadFailed")}
            message={readErrorMessage(capabilitiesError)}
            retryLabel={t("copilot.retry")}
            onRetry={() => {
              void refetchCapabilities();
            }}
          />
        )}
        {runsLoadFailed && (
          <QueryErrorNotice
            title={t("copilot.runsLoadFailed")}
            message={readErrorMessage(runsError)}
            retryLabel={t("copilot.retry")}
            onRetry={() => {
              void refetchRuns();
            }}
          />
        )}
        {selectedRunLoadFailed && resolvedRunId && (
          <QueryErrorNotice
            title={t("copilot.runDetailsLoadFailed")}
            message={readErrorMessage(selectedRunError)}
            retryLabel={t("copilot.retry")}
            onRetry={() => {
              void refetchSelectedRun();
            }}
          />
        )}
        {modelProvidersLoadFailed && (
          <QueryErrorNotice
            title={t("copilot.modelProvidersLoadFailed")}
            message={readErrorMessage(modelProvidersError)}
            retryLabel={t("copilot.retry")}
            onRetry={() => {
              void refetchModelProviders();
            }}
          />
        )}
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
              <label htmlFor="copilot-prompt" className="sr-only">
                {t("copilot.promptLabel")}
              </label>
              <textarea
                id="copilot-prompt"
                aria-describedby={`copilot-prompt-hint${errorMessage ? " copilot-error" : ""}`}
                className="min-h-[132px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                value={prompt}
                placeholder={t("copilot.promptPlaceholder")}
                onChange={(event) => setPrompt(event.target.value)}
              />
              <div className="flex flex-wrap gap-2" aria-label={t("copilot.starterPrompts")}>
                {starterPrompts.map((starter) => (
                  <Button
                    key={starter.labelKey}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPrompt(t(starter.promptKey))}
                  >
                    {t(starter.labelKey)}
                  </Button>
                ))}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm font-medium" htmlFor="copilot-provider">
                  <span>{t("copilot.providerSelect")}</span>
                  <select
                    id="copilot-provider"
                    aria-label={t("copilot.providerSelect")}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                    value={selectedProviderId}
                    disabled={modelProvidersLoading || copilotProviders.length === 0}
                    onChange={(event) => {
                      setSelectedProviderId(event.target.value);
                      setSelectedModelProfileId("");
                    }}
                  >
                    {copilotProviders.length === 0 ? (
                      <option value="">
                        {modelProvidersLoading ? t("common.loading") : t("copilot.noSelectableProviders")}
                      </option>
                    ) : (
                      copilotProviders.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))
                    )}
                  </select>
                </label>
                <label className="space-y-1 text-sm font-medium" htmlFor="copilot-model">
                  <span>{t("copilot.modelSelect")}</span>
                  <select
                    id="copilot-model"
                    aria-label={t("copilot.modelSelect")}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                    value={selectedModelProfileId}
                    disabled={modelProvidersLoading || providerModels.length === 0}
                    onChange={(event) => setSelectedModelProfileId(event.target.value)}
                  >
                    {providerModels.length === 0 ? (
                      <option value="">
                        {modelProvidersLoading ? t("common.loading") : t("copilot.noSelectableModels")}
                      </option>
                    ) : (
                      providerModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))
                    )}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div id="copilot-prompt-hint" className="text-sm text-muted-foreground">
                  {providerSetupRequired ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <span>{t("copilot.providerSetupRequired")}</span>
                      <Link
                        href="/models"
                        className="font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        {t("copilot.configureProvider")}
                      </Link>
                    </span>
                  ) : liveRunActive ? (
                    t("copilot.runAlreadyActive")
                  ) : (
                    modelProvidersLoading
                      ? t("common.loading")
                      : modelProvidersLoadFailed
                        ? t("copilot.modelProvidersLoadFailed")
                        : !selectedProviderId
                          ? t("copilot.noSelectableProviders")
                          : !selectedModelProfileId
                            ? t("copilot.noSelectableModels")
                            : statusSummary
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {liveRun && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={cancelMutation.isPending}
                      onClick={() => cancelMutation.mutate(liveRun.id)}
                    >
                      <Square className="mr-2 size-4" />
                      {t("copilot.stop")}
                    </Button>
                  )}
                  <Button
                    type="button"
                    disabled={!canStartCopilotRun}
                    onClick={() => createMutation.mutate(prompt)}
                  >
                    <Play className="mr-2 size-4" />
                    {createMutation.isPending ? t("common.loading") : t("copilot.start")}
                  </Button>
                </div>
              </div>
              {errorMessage && (
                <div
                  id="copilot-error"
                  role="alert"
                  aria-live="polite"
                  className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {formatCopilotErrorMessage(errorMessage, errorCode, t)}
                    {errorCode && (
                      <span className="mt-1 block font-mono text-xs">{errorCode}</span>
                    )}
                  </span>
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
                <div className="space-y-3">
                  <RunMetadata
                    run={latestRun}
                    sourceLabel={t("copilot.source")}
                    providerLabel={t("copilot.provider")}
                    modelLabel={t("copilot.model")}
                    stepsLabel={t("copilot.steps")}
                    ariaLabel={t("copilot.selectedRunMetadata")}
                  />
                  <RunFailureNotice
                    title={t("copilot.runFailureTitle")}
                    codeLabel={t("copilot.errorCode")}
                    messageLabel={t("copilot.errorMessage")}
                    errorCode={latestRun.errorCode}
                    errorMessage={latestRun.errorMessage}
                  />
                  <RunTimeline
                    events={timelineEvents}
                    noEventsLabel={
                      selectedRunLoadFailed
                        ? t("copilot.runDetailsUnavailable")
                        : selectedRunLoading
                          ? t("common.loading")
                          : t("copilot.noEvents")
                    }
                    getEventLabel={(type) => {
                      const labelKey = getCopilotEventLabelKey(type);
                      return labelKey ? t(labelKey) : getCopilotEventLabel(type);
                    }}
                  />
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
                  {runsLoadFailed ? t("copilot.runsUnavailable") : runsLoading ? t("common.loading") : t("copilot.noRuns")}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("copilot.pendingActions")}</CardTitle>
            </CardHeader>
            <CardContent>
              <PendingActions
                actions={pendingActions}
                approveLabel={t("copilot.approve")}
                rejectLabel={t("copilot.reject")}
                loadingLabel={t("common.loading")}
                processingActionId={processingActionId}
                proposedActionLabel={t("copilot.proposedAction")}
                getActionLabel={(type) => {
                  const labelKey = getCopilotPendingActionLabelKey(type);
                  return labelKey ? t(labelKey) : getCopilotPendingActionLabel(type);
                }}
                onApprove={(action) => {
                  if (!markProcessingAction(action.id, processingActionIdRef, setProcessingActionId)) return;
                  approveMutation.mutate(action);
                }}
                onReject={(action) => {
                  if (!markProcessingAction(action.id, processingActionIdRef, setProcessingActionId)) return;
                  rejectMutation.mutate(action);
                }}
              />
            </CardContent>
          </Card>

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
                  {runsLoadFailed ? t("copilot.runsUnavailable") : runsLoading ? t("common.loading") : t("copilot.noRuns")}
                </div>
              ) : (
                runs.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    aria-pressed={run.id === resolvedRunId}
                    className={`w-full rounded-md border p-3 text-left transition-colors hover:border-brand/60 hover:bg-muted/30 ${
                      run.id === resolvedRunId ? "border-brand/60 bg-brand/10" : "border-border"
                    }`}
                    onClick={() => {
                      setSelectedRunId(run.id);
                      clearErrorState(setErrorMessage, setErrorCode);
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 truncate text-sm font-medium">{run.goal}</div>
                      <StatusBadge status={run.status} />
                    </div>
                    <RunMetadata
                      run={run}
                      sourceLabel={t("copilot.source")}
                      providerLabel={t("copilot.provider")}
                      modelLabel={t("copilot.model")}
                      stepsLabel={t("copilot.steps")}
                      ariaLabel={`${t("copilot.runMetadataFor")} ${run.goal}`}
                      compact
                    />
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function RunMetadata({
  run,
  sourceLabel,
  providerLabel,
  modelLabel,
  stepsLabel,
  ariaLabel,
  compact = false,
}: {
  run: CopilotRun;
  sourceLabel: string;
  providerLabel: string;
  modelLabel: string;
  stepsLabel: string;
  ariaLabel: string;
  compact?: boolean;
}) {
  const items = [
    { label: sourceLabel, value: normalizeRunErrorDetail(run.source) },
    {
      label: providerLabel,
      value: normalizeRunErrorDetail(run.providerProfileName) ?? normalizeRunErrorDetail(run.providerProfileId),
    },
    {
      label: modelLabel,
      value: normalizeRunErrorDetail(run.modelProfileName) ?? normalizeRunErrorDetail(run.modelProfileId),
    },
    { label: stepsLabel, value: formatRunSteps(run.stepCount, run.maxSteps) },
  ].filter((item): item is { label: string; value: string } => Boolean(item.value));
  if (items.length === 0) return null;

  return (
    <dl
      aria-label={ariaLabel}
      className={`flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground ${compact ? "mt-2" : ""}`}
    >
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 items-center gap-1">
          <dt className="shrink-0 font-medium text-muted-foreground/80">{item.label}</dt>
          <dd className="min-w-0 max-w-full truncate font-mono text-muted-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function isSelectableCopilotModel(model: ModelProfile) {
  return model.status === "active";
}

function RunFailureNotice({
  title,
  codeLabel,
  messageLabel,
  errorCode,
  errorMessage,
}: {
  title: string;
  codeLabel: string;
  messageLabel: string;
  errorCode?: string | null;
  errorMessage?: string | null;
}) {
  const code = normalizeRunErrorDetail(errorCode);
  const message = normalizeRunErrorDetail(errorMessage);
  if (!code && !message) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 space-y-2">
        <div className="font-medium">{title}</div>
        {code && (
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-normal text-destructive/80">{codeLabel}</div>
            <div className="break-all font-mono text-xs text-destructive">{code}</div>
          </div>
        )}
        {message && (
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-normal text-destructive/80">{messageLabel}</div>
            <div className="break-words text-destructive/90">{message}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function PendingActions({
  actions,
  approveLabel,
  rejectLabel,
  loadingLabel,
  processingActionId,
  proposedActionLabel,
  getActionLabel,
  onApprove,
  onReject,
}: {
  actions: CopilotPendingAction[];
  approveLabel: string;
  rejectLabel: string;
  loadingLabel: string;
  processingActionId: string | null;
  proposedActionLabel: string;
  getActionLabel: (type: string) => string;
  onApprove: (action: CopilotPendingAction) => void;
  onReject: (action: CopilotPendingAction) => void;
}) {
  if (actions.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
        {proposedActionLabel}: 0
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {actions.map((action) => {
        const isProcessing = processingActionId === action.id;
        const actionsDisabled = Boolean(processingActionId);
        const summary = getCopilotPendingActionSummary(action);
        return (
          <div key={action.id} className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">{getActionLabel(action.type)}</div>
              <Badge variant={action.status === "pending" ? "secondary" : "outline"}>{action.status}</Badge>
            </div>
            {summary && (
              <div className="mt-2 rounded-md bg-muted/20 p-2 text-xs">
                <div className="font-medium text-foreground">{summary.detail}</div>
                {summary.preview && (
                  <div className="mt-1 break-words leading-5 text-muted-foreground">
                    {summary.preview}
                  </div>
                )}
              </div>
            )}
            <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-muted/30 p-2 text-xs text-muted-foreground">
              {JSON.stringify(action.result ?? action.input ?? {}, null, 2)}
            </pre>
            {action.status === "pending" && (
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actionsDisabled}
                  onClick={() => onReject(action)}
                >
                  {isProcessing ? loadingLabel : rejectLabel}
                </Button>
                <Button size="sm" disabled={actionsDisabled} onClick={() => onApprove(action)}>
                  {isProcessing ? loadingLabel : approveLabel}
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function QueryErrorNotice({
  title,
  message,
  retryLabel,
  onRetry,
}: {
  title: string;
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <div className="flex min-w-0 items-start gap-2">
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <div className="font-medium">{title}</div>
          <div className="mt-1 break-words text-destructive/90">{message}</div>
        </div>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}

function RunTimeline({
  events,
  noEventsLabel,
  getEventLabel,
}: {
  events: CopilotRunEvent[];
  noEventsLabel: string;
  getEventLabel: (type: string) => string;
}) {
  if (events.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
        {noEventsLabel}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((event) => {
        const payloadPreview = formatEventPayloadPreview(event);
        return (
          <div key={event.id} className="rounded-md border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{getEventLabel(event.type)}</span>
              <span>#{event.sequence}</span>
            </div>
            {event.message && (
              <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                {event.message}
              </div>
            )}
            {payloadPreview && (
              <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-background/70 p-2 text-xs text-muted-foreground">
                {payloadPreview}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatEventPayloadPreview(event: CopilotRunEvent): string | null {
  if (event.type === "assistant_message" || !event.payload) return null;
  const serialized = JSON.stringify(event.payload, null, 2);
  if (!serialized || serialized === "{}") return null;
  const maxLength = 2_000;
  if (serialized.length <= maxLength) return serialized;
  return `${serialized.slice(0, maxLength).trimEnd()}\n...`;
}

function StatusBadge({ status }: { status: string }) {
  const tone = getCopilotStatusTone(status);
  const variant = tone === "danger" ? "destructive" : tone === "success" ? "default" : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Copilot request failed";
}

function readGatewayErrorCode(error: unknown): string {
  const code = error instanceof GatewayApiError ? error.details?.code : undefined;
  return typeof code === "string" ? code : "";
}

function formatCopilotErrorMessage(
  fallbackMessage: string,
  code: string,
  t: (key: TranslationKey) => string
): string {
  const messageKey = getCopilotErrorMessageKey(code);
  return messageKey ? t(messageKey) : fallbackMessage;
}

function applyErrorState(
  error: unknown,
  setErrorMessage: Dispatch<SetStateAction<string>>,
  setErrorCode: Dispatch<SetStateAction<string>>
): void {
  setErrorMessage(readErrorMessage(error));
  setErrorCode(readGatewayErrorCode(error));
}

function clearErrorState(
  setErrorMessage: Dispatch<SetStateAction<string>>,
  setErrorCode: Dispatch<SetStateAction<string>>
): void {
  setErrorMessage("");
  setErrorCode("");
}

function normalizeRunErrorDetail(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function formatRunSteps(stepCount: number | null | undefined, maxSteps: number | null | undefined): string | null {
  const step = normalizeRunStep(stepCount);
  if (step === null) return null;
  const max = normalizeRunStep(maxSteps);
  return max !== null && max > 0 ? `${step}/${max}` : String(step);
}

function normalizeRunStep(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.trunc(value);
}

function markProcessingAction(
  actionId: string,
  processingActionIdRef: { current: string | null },
  setProcessingActionId: Dispatch<SetStateAction<string | null>>
): boolean {
  if (processingActionIdRef.current) return false;
  processingActionIdRef.current = actionId;
  setProcessingActionId(actionId);
  return true;
}

function clearProcessingAction(
  processingActionIdRef: { current: string | null },
  setProcessingActionId: Dispatch<SetStateAction<string | null>>
): void {
  processingActionIdRef.current = null;
  setProcessingActionId(null);
}

function isProviderSetupError(code: string): boolean {
  return code === "copilot_provider_not_configured";
}

function updatePendingAction(
  action: CopilotPendingAction,
  setActiveRun: Dispatch<SetStateAction<ActiveRunState | null>>
): void {
  setActiveRun((current) => {
    if (!current) return current;
    return {
      ...current,
      pendingActions: (current.pendingActions ?? []).map((item) =>
        item.id === action.id ? action : item
      ),
    };
  });
}

function applyPendingActionResult(
  result: CopilotPendingActionDecision,
  setActiveRun: Dispatch<SetStateAction<ActiveRunState | null>>
): void {
  if (!result.run) {
    updatePendingAction(result.action, setActiveRun);
    return;
  }
  setActiveRun({
    run: result.run,
    events: result.events ?? [],
    pendingActions: result.pendingActions ?? [],
  });
}

function cachePendingActionResult(
  result: CopilotPendingActionDecision,
  queryClient: QueryClient
): void {
  if (!result.run) return;
  queryClient.setQueryData(["copilot-run", result.run.id], {
    run: result.run,
    events: result.events ?? [],
    pendingActions: result.pendingActions ?? [],
  });
}
