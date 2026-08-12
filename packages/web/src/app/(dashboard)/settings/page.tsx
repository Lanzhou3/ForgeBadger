"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, Cpu, Download, FlaskConical, Globe2, KeyRound, MessageSquare, Palette, RefreshCw, ScrollText, ServerCog, Settings2, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RuntimeSetupCommands } from "@/components/runtime-setup-commands";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/hooks/use-language";
import {
  ACCENT_THEMES,
  DEFAULT_ACCENT_ID,
  applyAccentTheme,
  readStoredAccent,
} from "@/lib/accent-theme";
import {
  getBrowserNotificationPermission,
  getBrowserNotificationPreference,
  requestBrowserNotificationPermission,
  setBrowserNotificationPreference,
  type BrowserNotificationPermission,
} from "@/lib/browser-notifications";
import {
  discoverAdapters,
  exportDiagnostics,
  getDependencies,
  getFeishuIntegrationStatus,
  listAuditLogs,
  type AdapterDiscovery,
  type FeishuIntegrationStatus,
  type LocalDiagnosticsExport
} from "@/lib/api";
import type { Language, TranslationKey } from "@/lib/i18n";
import { getTerminalRuntimeSetupGuidance } from "@/lib/terminal-runtime";

const languageOptions = [
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "en", label: "English" },
];

export default function SettingsPage() {
  const { language, setLanguage, t } = useLanguage();
  const queryClient = useQueryClient();
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(false);
  const [browserNotificationPermission, setBrowserNotificationPermission] =
    useState<BrowserNotificationPermission>("unsupported");
  const [diagnosticsState, setDiagnosticsState] = useState<"idle" | "exporting" | "success" | "error">("idle");
  const [accentId, setAccentId] = useState(DEFAULT_ACCENT_ID);

  useEffect(() => {
    setAccentId(readStoredAccent());
  }, []);
  const {
    data: adapterData,
    isLoading: adaptersLoading,
    isFetching: adaptersFetching,
    isError: adaptersError,
    refetch: refetchAdapters,
  } = useQuery({
    queryKey: ["adapters", "discovery"],
    queryFn: discoverAdapters,
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
  const {
    data: feishuStatus,
    isLoading: feishuStatusLoading,
    isError: feishuStatusError
  } = useQuery({
    queryKey: ["feishu-integration-status"],
    queryFn: getFeishuIntegrationStatus,
  });
  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ["audit-logs", "settings"],
    queryFn: () => listAuditLogs({ limit: 8 }),
  });

  useEffect(() => {
    setBrowserNotificationsEnabled(getBrowserNotificationPreference());
    setBrowserNotificationPermission(getBrowserNotificationPermission());
  }, []);

  async function toggleBrowserNotifications(enabled: boolean) {
    if (!enabled) {
      setBrowserNotificationPreference(false);
      setBrowserNotificationsEnabled(false);
      setBrowserNotificationPermission(getBrowserNotificationPermission());
      return;
    }

    const permission =
      getBrowserNotificationPermission() === "default"
        ? await requestBrowserNotificationPermission()
        : getBrowserNotificationPermission();
    setBrowserNotificationPermission(permission);
    const allowed = permission === "granted";
    setBrowserNotificationPreference(allowed);
    setBrowserNotificationsEnabled(allowed);
  }

  async function handleDiagnosticsExport() {
    setDiagnosticsState("exporting");
    try {
      const { report } = await exportDiagnostics();
      downloadDiagnosticsReport(report);
      setDiagnosticsState("success");
    } catch {
      setDiagnosticsState("error");
    }
  }

  async function handleDependencyRefresh() {
    await Promise.all([refetchDependencies(), refetchAdapters()]);
    await queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
  }

  const terminalRuntime = dependenciesData?.terminalRuntime;
  const terminalSetupGuidance = getTerminalRuntimeSetupGuidance(
    terminalRuntime?.mode,
    terminalRuntime?.supported
  );
  const tmuxDependency = dependenciesData?.dependencies.find((dependency) => dependency.name === "tmux");
  const discoveryRefreshing = adaptersFetching || dependenciesFetching;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
        <p className="mt-1 text-muted-foreground">
          {t("settings.subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Globe2 className="size-4 text-muted-foreground" />
                <CardTitle>{t("settings.language")}</CardTitle>
              </div>
              <CardDescription>
                {t("settings.languageDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {languageOptions.map((option) => (
                  <Button
                    key={option.code}
                    type="button"
                    variant={language === option.code ? "default" : "outline"}
                    size="sm"
                    onClick={() => setLanguage(option.code as Language)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Palette className="size-4 text-muted-foreground" />
                <CardTitle>{t("settings.theme")}</CardTitle>
              </div>
              <CardDescription>
                {t("settings.themeDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {ACCENT_THEMES.map((theme) => {
                  const selected = accentId === theme.id;
                  return (
                    <button
                      key={theme.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setAccentId(applyAccentTheme(theme.id))}
                      className={
                        selected
                          ? "flex items-center gap-2 rounded-md border border-brand/60 bg-brand/10 px-3 py-2 text-sm text-foreground transition-colors duration-150"
                          : "flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors duration-150 hover:border-border/80 hover:bg-white/[0.03] hover:text-foreground"
                      }
                    >
                      <span
                        className="size-3.5 rounded-full ring-1 ring-white/20"
                        style={{ backgroundColor: theme.swatch }}
                        aria-hidden="true"
                      />
                      {t(theme.nameKey)}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Settings2 className="size-4 text-muted-foreground" />
                <CardTitle>{t("settings.console")}</CardTitle>
              </div>
              <CardDescription>
                {t("settings.consoleDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <SettingRow
                title={t("settings.autoReconnect")}
                description={t("settings.autoReconnectDescription")}
                checked
              />
              <SettingRow
                title={t("settings.showStoppedSessions")}
                description={t("settings.showStoppedSessionsDescription")}
                checked
              />
              <SettingRow
                title={t("settings.browserNotifications")}
                description={
                  browserNotificationPermission === "denied"
                    ? t("settings.browserNotificationsDenied")
                    : t("settings.browserNotificationsDescription")
                }
                checked={browserNotificationsEnabled && browserNotificationPermission === "granted"}
                disabled={browserNotificationPermission === "unsupported"}
                onCheckedChange={toggleBrowserNotifications}
                icon={<Bell className="size-4 text-muted-foreground" />}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Cpu className="size-4 text-muted-foreground" />
                    <CardTitle>{t("settings.adapters")}</CardTitle>
                  </div>
                  <CardDescription className="mt-2">
                    {t("settings.adaptersDescription")}
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleDependencyRefresh()}
                  disabled={discoveryRefreshing}
                >
                  <RefreshCw className={`mr-2 size-3.5 ${discoveryRefreshing ? "animate-spin" : ""}`} />
                  {discoveryRefreshing ? t("settings.discoveryRefreshing") : t("settings.discoveryRefresh")}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {dependenciesLoading ? (
                <p className="text-sm text-muted-foreground">
                  {t("settings.dependenciesLoading")}
                </p>
              ) : dependenciesError ? (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-4 text-destructive" />
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
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">{t("settings.terminalRuntimeReadiness")}</div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t(terminalSetupGuidance.descriptionKey)}
                      </p>
                      {(tmuxDependency?.version || tmuxDependency?.error) && (
                        <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                          {tmuxDependency.version ?? tmuxDependency.error}
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
                <p className="text-sm text-muted-foreground">
                  {t("settings.discoveryLoading")}
                </p>
              ) : adaptersError ? (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-4 text-destructive" />
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
                    <RefreshCw className="mr-2 size-3.5" />
                    {t("settings.discoveryRetry")}
                  </Button>
                </div>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.adapterReadinessNotice")}
                  </p>
                  {adapterData?.adapters.map((adapter) => (
                    <AdapterItem key={adapter.id} adapter={adapter} />
                  ))}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <MessageSquare className="size-4 text-muted-foreground" />
                <CardTitle>{t("settings.feishuIntegration")}</CardTitle>
              </div>
              <CardDescription>
                {t("settings.feishuIntegrationDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {feishuStatusLoading ? (
                <p className="text-sm text-muted-foreground">
                  {t("settings.feishuStatusLoading")}
                </p>
              ) : feishuStatusError ? (
                <p className="text-sm text-muted-foreground">
                  {t("settings.feishuStatusLoadFailed")}
                </p>
              ) : feishuStatus ? (
                <FeishuIntegrationItem status={feishuStatus} />
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <FlaskConical className="size-4 text-muted-foreground" />
                <CardTitle>{t("settings.experimentalFeatures")}</CardTitle>
              </div>
              <CardDescription>
                {t("settings.experimentalFeaturesDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                <div className="flex min-w-0 items-start gap-3">
                  <ServerCog className="mt-0.5 size-4 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="font-medium">{t("settings.codexAppServerExperiment")}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {t("settings.codexAppServerExperimentDescription")}
                    </div>
                  </div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href="/codex-app-server">{t("common.open")}</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-muted-foreground" />
                <CardTitle>{t("settings.securityBaseline")}</CardTitle>
              </div>
              <CardDescription>
                {t("settings.securityDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <SecurityItem label={t("settings.jwtAuth")} value={t("settings.enabled")} />
              <SecurityItem label={t("settings.tenantIsolation")} value={t("settings.enabled")} />
              <SecurityItem label={t("settings.apiKeyEncryption")} value="AES-256-GCM" />
              <SecurityItem label={t("settings.terminalPersistence")} value="tmux" />
              <div className="flex items-center gap-2 rounded-md border border-border p-3">
                <KeyRound className="size-4 text-muted-foreground" />
                <span className="text-muted-foreground">
                  {t("settings.secretsNotice")}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Download className="size-4 text-muted-foreground" />
                <CardTitle>{t("settings.diagnostics")}</CardTitle>
              </div>
              <CardDescription>
                {t("settings.diagnosticsDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                onClick={handleDiagnosticsExport}
                disabled={diagnosticsState === "exporting"}
              >
                <Download className="mr-2 size-4" />
                {diagnosticsState === "exporting"
                  ? t("settings.diagnosticsExporting")
                  : t("settings.diagnosticsExport")}
              </Button>
              <p className="text-xs text-muted-foreground">
                {diagnosticsState === "success"
                  ? t("settings.diagnosticsExported")
                  : diagnosticsState === "error"
                    ? t("settings.diagnosticsExportFailed")
                    : t("settings.diagnosticsNotice")}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ScrollText className="size-4 text-muted-foreground" />
                <CardTitle>{t("settings.auditHistory")}</CardTitle>
              </div>
              <CardDescription>
                {t("settings.auditDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {auditLoading ? (
                <p className="text-muted-foreground">{t("settings.auditLoading")}</p>
              ) : (auditData?.auditLogs.length ?? 0) === 0 ? (
                <p className="text-muted-foreground">{t("settings.auditEmpty")}</p>
              ) : (
                auditData?.auditLogs.map((entry) => (
                  <div key={entry.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{entry.action}</span>
                      <Badge variant="outline">{entry.resourceType}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function FeishuIntegrationItem({ status }: { status: FeishuIntegrationStatus }) {
  const { t } = useLanguage();
  const enabledState = status.emergencyDisabled
    ? t("settings.feishuEmergencyDisabled")
    : status.enabled
      ? t("settings.feishuEnabled")
      : t("settings.feishuDisabled");

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">{t("settings.feishuIntegration")}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {t("settings.feishuPhaseOneNotice")}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={status.available ? "secondary" : "outline"}>
            {status.available ? t("settings.feishuCliAvailable") : t("settings.feishuCliMissing")}
          </Badge>
          <Badge variant={status.enabled ? "secondary" : "outline"}>
            {enabledState}
          </Badge>
        </div>
      </div>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <StatusField label={t("settings.feishuVersion")} value={status.version ?? "-"} />
        <StatusField label={t("settings.feishuAuthState")} value={formatFeishuAuthState(status.authState, t)} />
        <StatusField label={t("settings.feishuIdentityMode")} value={formatFeishuIdentityMode(status.identityMode, t)} />
        <StatusField label={t("settings.feishuEnabledState")} value={enabledState} />
      </div>
    </div>
  );
}

function StatusField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right font-medium">{value}</span>
    </div>
  );
}

function formatFeishuAuthState(
  authState: FeishuIntegrationStatus["authState"],
  t: (key: TranslationKey) => string
): string {
  if (authState === "authenticated") return t("settings.feishuAuthAuthenticated");
  if (authState === "unauthenticated") return t("settings.feishuAuthUnauthenticated");
  return t("settings.feishuAuthUnknown");
}

function formatFeishuIdentityMode(
  identityMode: FeishuIntegrationStatus["identityMode"],
  t: (key: TranslationKey) => string
): string {
  if (identityMode === "user") return t("settings.feishuIdentityUser");
  if (identityMode === "bot") return t("settings.feishuIdentityBot");
  return t("settings.feishuIdentityUnknown");
}

function downloadDiagnosticsReport(report: LocalDiagnosticsExport) {
  const generatedAt = report.generatedAt.replace(/[:.]/g, "-");
  const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `openforge-diagnostics-${generatedAt}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function AdapterItem({ adapter }: { adapter: AdapterDiscovery }) {
  const { t } = useLanguage();

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">{adapter.label}</div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">
            {adapter.command} --version
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
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
      {adapter.runtimeModes.length > 0 && (
        <div className="mt-2 font-mono text-xs text-muted-foreground">
          {adapter.runtimeModes.join(" / ")}
        </div>
      )}
    </div>
  );
}

function SettingRow({
  title,
  description,
  checked,
  disabled = true,
  onCheckedChange,
  icon,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
      <div className="flex min-w-0 items-start gap-3">
        {icon}
        <div className="min-w-0">
          <div className="font-medium">{title}</div>
          <div className="mt-1 text-sm text-muted-foreground">{description}</div>
        </div>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label={title}
      />
    </div>
  );
}

function SecurityItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <span className="text-muted-foreground">{label}</span>
      <Badge variant="secondary">{value}</Badge>
    </div>
  );
}
