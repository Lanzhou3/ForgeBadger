"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Cpu, Download, RefreshCw } from "lucide-react";

import { ADAPTER_DISCOVERY_QUERY_KEY } from "@/components/adapter-select";
import { CliBrandChip } from "@/components/cli-brand-chip";
import { RuntimeSetupCommands } from "@/components/runtime-setup-commands";
import { SettingsCardHeader } from "@/components/settings/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLanguage } from "@/hooks/use-language";
import {
  checkAdapterUpdates,
  discoverAdapters,
  getDependencies,
  installAdapter,
  updateAdapter,
  type AdapterDiscovery,
  type AdapterUpdateStatus,
  type RuntimeAdapterId,
} from "@/lib/api";
import { getTerminalRuntimeSetupGuidance } from "@/lib/terminal-runtime";
import { cn } from "@/lib/utils";

/** AI CLI adapter discovery card: terminal runtime readiness plus per-CLI
 * detect / install / update actions. Admin-gated operations come from the
 * adapter-updates endpoint (canUpdate / canInstall). */
export function AdapterSettings() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [updatingAdapter, setUpdatingAdapter] = useState<RuntimeAdapterId | null>(null);
  const [installingAdapter, setInstallingAdapter] = useState<RuntimeAdapterId | null>(null);
  const [refreshingUpdates, setRefreshingUpdates] = useState(false);
  const [updateRefreshError, setUpdateRefreshError] = useState(false);
  const [updateFeedback, setUpdateFeedback] = useState<Partial<Record<RuntimeAdapterId, "done" | "behind" | "failed">>>({});
  const [installFeedback, setInstallFeedback] = useState<Partial<Record<RuntimeAdapterId, "done" | "not_detected" | "failed">>>({});

  const {
    data: adapterData,
    isLoading: adaptersLoading,
    isFetching: adaptersFetching,
    isError: adaptersError,
    refetch: refetchAdapters,
  } = useQuery({
    queryKey: ADAPTER_DISCOVERY_QUERY_KEY,
    queryFn: discoverAdapters,
  });
  const {
    data: adapterUpdates,
    isFetching: updatesFetching,
    isError: updatesError,
    refetch: refetchUpdates,
  } = useQuery({
    queryKey: ["adapter-updates"],
    queryFn: () => checkAdapterUpdates(),
    staleTime: 5 * 60 * 1000,
  });
  const {
    data: dependenciesData,
    isLoading: dependenciesLoading,
    isFetching: dependenciesFetching,
    isError: dependenciesError,
    refetch: refetchDependencies,
  } = useQuery({
    queryKey: ["dependencies"],
    queryFn: getDependencies,
  });

  async function handleDependencyRefresh() {
    setRefreshingUpdates(true);
    setUpdateRefreshError(false);
    try {
      const results = await Promise.allSettled([
        refetchDependencies(),
        refetchAdapters(),
        checkAdapterUpdates(true)
      ]);
      const updatesResult = results[2];
      if (updatesResult.status === "fulfilled") {
        queryClient.setQueryData(["adapter-updates"], updatesResult.value);
      } else {
        setUpdateRefreshError(true);
      }
      await queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    } finally {
      setRefreshingUpdates(false);
    }
  }

  async function handleAdapterUpdate(id: RuntimeAdapterId) {
    setUpdatingAdapter(id);
    setUpdateFeedback((previous) => ({ ...previous, [id]: undefined }));
    try {
      const result = await updateAdapter(id);
      setUpdateFeedback((previous) => ({ ...previous, [id]: result.versionStillBehind ? "behind" : "done" }));
      await Promise.all([refetchAdapters(), refetchDependencies(), refetchUpdates()]);
    } catch {
      setUpdateFeedback((previous) => ({ ...previous, [id]: "failed" }));
    } finally {
      setUpdatingAdapter(null);
    }
  }

  async function handleAdapterInstall(id: RuntimeAdapterId) {
    setInstallingAdapter(id);
    setInstallFeedback((previous) => ({ ...previous, [id]: undefined }));
    try {
      const result = await installAdapter(id);
      setInstallFeedback((previous) => ({ ...previous, [id]: result.commandAvailable ? "done" : "not_detected" }));
      await Promise.allSettled([refetchAdapters(), refetchDependencies(), refetchUpdates()]);
    } catch {
      setInstallFeedback((previous) => ({ ...previous, [id]: "failed" }));
    } finally {
      setInstallingAdapter(null);
    }
  }

  const terminalRuntime = dependenciesData?.terminalRuntime;
  const terminalSetupGuidance = getTerminalRuntimeSetupGuidance(
    terminalRuntime?.mode,
    terminalRuntime?.supported
  );
  const terminalPersistence = terminalRuntime?.persistence;
  const terminalDependency = dependenciesData?.dependencies.find(
    (dependency) => dependency.name === terminalPersistence
  );
  const terminalDependencyDetail =
    terminalDependency?.version ?? terminalDependency?.error ?? terminalRuntime?.message;
  const discoveryRefreshing = adaptersFetching || dependenciesFetching || updatesFetching || refreshingUpdates;

  return (
    <Card className="forgebadger-animate-in">
      <SettingsCardHeader
        icon={<Cpu className="size-4" />}
        title={t("settings.adapters")}
        description={t("settings.adaptersDescription")}
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleDependencyRefresh()}
            disabled={discoveryRefreshing}
          >
            <RefreshCw className={cn("size-3.5", discoveryRefreshing && "animate-spin")} />
            {discoveryRefreshing ? t("settings.discoveryRefreshing") : t("settings.discoveryRefresh")}
          </Button>
        }
      />
      <CardContent className="space-y-3">
        {dependenciesLoading ? (
          <p className="text-xs text-muted-foreground">
            {t("settings.dependenciesLoading")}
          </p>
        ) : dependenciesError ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-destructive">
                  {t("settings.dependenciesLoadFailed")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("settings.discoveryLoadFailedDescription")}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-border/70 bg-muted/20 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      terminalSetupGuidance.blocked ? "bg-red-400" : "bg-emerald-400"
                    )}
                  />
                  <span className="text-sm font-medium">{t("settings.terminalRuntimeReadiness")}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(terminalSetupGuidance.descriptionKey)}
                </p>
                {terminalDependencyDetail && (
                  <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                    {terminalDependencyDetail}
                  </p>
                )}
              </div>
              <Badge variant={terminalSetupGuidance.blocked ? "destructive" : "secondary"}>
                {terminalSetupGuidance.blocked
                  ? t("settings.launchBlocked")
                  : t("settings.launchReady")}
              </Badge>
            </div>
            {terminalSetupGuidance.blocked && (
              <div className="mt-3">
                <RuntimeSetupCommands guidance={terminalSetupGuidance} />
              </div>
            )}
          </div>
        )}
        {adaptersLoading ? (
          <p className="text-xs text-muted-foreground">
            {t("settings.discoveryLoading")}
          </p>
        ) : adaptersError ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-destructive">
                  {t("settings.discoveryLoadFailed")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("settings.discoveryLoadFailedDescription")}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void refetchAdapters()}
            >
              <RefreshCw className="size-3.5" />
              {t("settings.discoveryRetry")}
            </Button>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {t("settings.adapterReadinessNotice")}
            </p>
            <div className="space-y-2">
              {adapterData?.adapters.map((adapter) => (
                <AdapterItem
                  key={adapter.id}
                  adapter={adapter}
                  update={updateRefreshError ? undefined : adapterUpdates?.updates.find((item) => item.id === adapter.id)}
                  canUpdate={adapterUpdates?.canUpdate ?? false}
                  canInstall={adapterUpdates?.canInstall ?? false}
                  checkingUpdate={updatesFetching || refreshingUpdates}
                  updateCheckFailed={updatesError || updateRefreshError}
                  updating={updatingAdapter === adapter.id}
                  installing={installingAdapter === adapter.id}
                  operationBlocked={updatingAdapter !== null || installingAdapter !== null}
                  feedback={updateFeedback[adapter.id]}
                  installFeedback={installFeedback[adapter.id]}
                  onUpdate={() => void handleAdapterUpdate(adapter.id)}
                  onInstall={() => void handleAdapterInstall(adapter.id)}
                />
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AdapterItem({
  adapter, update, canUpdate, canInstall, checkingUpdate, updateCheckFailed,
  updating, installing, operationBlocked, feedback, installFeedback, onUpdate, onInstall,
}: {
  adapter: AdapterDiscovery;
  update?: AdapterUpdateStatus;
  canUpdate: boolean;
  canInstall: boolean;
  checkingUpdate: boolean;
  updateCheckFailed: boolean;
  updating: boolean;
  installing: boolean;
  operationBlocked: boolean;
  feedback?: "done" | "behind" | "failed";
  installFeedback?: "done" | "not_detected" | "failed";
  onUpdate: () => void;
  onInstall: () => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="rounded-md border border-border/70 p-3 transition-colors hover:bg-muted/40">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              adapter.available ? "bg-emerald-400" : "bg-red-400"
            )}
          />
          <CliBrandChip aiTool={adapter.id} />
          <span className="truncate font-mono text-xs text-muted-foreground">
            {adapter.command} --version
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={adapter.available ? "secondary" : "outline"}>
            {adapter.available ? t("settings.available") : t("settings.missing")}
          </Badge>
          <Badge variant={adapter.supportLevel === "supported" ? "secondary" : "outline"}>
            {adapter.supportLevel === "supported" ? t("settings.supported") : t("settings.prototype")}
          </Badge>
          {adapter.launchEnabled ? (
            <Badge>{t("settings.launchEnabled")}</Badge>
          ) : (
            <Badge variant="outline">{t("settings.launchDisabled")}</Badge>
          )}
        </div>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {adapter.version ?? adapter.error ?? adapter.configDir}
      </div>
      {adapter.available && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {update?.state === "update_available" ? (
            <>
              <span className="text-amber-500">{t(update.latestSource === "homebrew" ? "settings.adapterUpdateAvailableHomebrew" : "settings.adapterUpdateAvailable")}: {update.latestVersion}</span>
              {canUpdate ? (
                <Button type="button" size="sm" variant="outline" disabled={operationBlocked || checkingUpdate} onClick={onUpdate}>
                  {updating ? <RefreshCw className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                  {updating ? t("settings.adapterUpdating") : t("settings.adapterUpdateNow")}
                </Button>
              ) : <span className="text-muted-foreground">{t("settings.adapterUpdateAdminOnly")}</span>}
              <span className="font-mono text-muted-foreground">{update.command}</span>
            </>
          ) : update?.state === "up_to_date" ? (
            <span className="text-muted-foreground">{t(update.latestSource === "homebrew" ? "settings.adapterUpToDateHomebrew" : "settings.adapterUpToDate")}: {update.installedVersion}</span>
          ) : update?.state === "check_failed" || updateCheckFailed ? (
            <span className="text-muted-foreground">{t("settings.adapterUpdateCheckFailed")}</span>
          ) : checkingUpdate ? (
            <span className="text-muted-foreground">{t("settings.adapterUpdateChecking")}</span>
          ) : null}
          {feedback && (
            <span role="status" className={feedback === "failed" ? "text-destructive" : "text-muted-foreground"}>
              {t(feedback === "done" ? "settings.adapterUpdateDone" : feedback === "behind" ? "settings.adapterUpdateBehind" : "settings.adapterUpdateFailed")}
            </span>
          )}
        </div>
      )}
      {adapter.status === "missing" && update?.state === "missing" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono text-muted-foreground">{update.installCommand}</span>
          {canInstall ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={operationBlocked || checkingUpdate || !!update.installRequiresNode || installFeedback === "done"}
              onClick={onInstall}
            >
              {installing ? <RefreshCw className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              {installing ? t("settings.adapterInstalling") : t("settings.adapterInstallNow")}
            </Button>
          ) : <span className="text-muted-foreground">{t("settings.adapterInstallAdminOnly")}</span>}
          {update.installRequiresNode && (
            <span className="text-amber-500">{t("settings.adapterInstallRequiresNode")} {update.installRequiresNode}+</span>
          )}
        </div>
      )}
      {installFeedback && (
        <p role="status" className={cn("mt-2 text-xs", installFeedback === "failed" ? "text-destructive" : "text-muted-foreground")}>
          {t(installFeedback === "done" ? "settings.adapterInstallDone" : installFeedback === "not_detected" ? "settings.adapterInstallNotDetected" : "settings.adapterInstallFailed")}
        </p>
      )}
      {adapter.runtimeModes.length > 0 && (
        <div className="mt-1.5 font-mono text-xs text-muted-foreground">
          {adapter.runtimeModes.join(" / ")}
        </div>
      )}
    </div>
  );
}
