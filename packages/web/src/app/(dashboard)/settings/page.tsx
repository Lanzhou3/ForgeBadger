"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, Cpu, Download, Globe2, KeyRound, Palette, RefreshCw, ScrollText, Settings2, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CliBrandChip } from "@/components/cli-brand-chip";
import { RuntimeSetupCommands } from "@/components/runtime-setup-commands";
import { AccountSecuritySettings } from "@/components/settings/AccountSecuritySettings";
import { FeishuIntegrationSettings } from "@/components/settings/FeishuIntegrationSettings";
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
  listAuditLogs,
  type AdapterDiscovery,
  type LocalDiagnosticsExport
} from "@/lib/api";
import type { Language } from "@/lib/i18n";
import { getTerminalRuntimeSetupGuidance } from "@/lib/terminal-runtime";
import { cn } from "@/lib/utils";

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
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t("settings.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card className="forgebadger-animate-in">
            <SettingsCardHeader
              icon={<Globe2 className="size-4" />}
              title={t("settings.language")}
              description={t("settings.languageDescription")}
            />
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {languageOptions.map((option) => (
                  <Button
                    key={option.code}
                    type="button"
                    variant={language === option.code ? "default" : "outline"}
                    size="sm"
                    className={language === option.code ? "bg-brand text-brand-foreground hover:bg-brand/90" : undefined}
                    onClick={() => setLanguage(option.code as Language)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="forgebadger-animate-in" style={{ animationDelay: "40ms" }}>
            <SettingsCardHeader
              icon={<Palette className="size-4" />}
              title={t("settings.theme")}
              description={t("settings.themeDescription")}
            />
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
                          : "flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors duration-150 hover:border-brand/40 hover:bg-muted/40 hover:text-foreground"
                      }
                    >
                      <span
                        className="size-3.5 rounded-full ring-1 ring-border"
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

          <Card className="forgebadger-animate-in" style={{ animationDelay: "80ms" }}>
            <SettingsCardHeader
              icon={<Settings2 className="size-4" />}
              title={t("settings.console")}
              description={t("settings.consoleDescription")}
            />
            <CardContent className="space-y-2">
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

          <div className="forgebadger-animate-in" style={{ animationDelay: "100ms" }}>
            <AccountSecuritySettings />
          </div>

          <Card className="forgebadger-animate-in" style={{ animationDelay: "120ms" }}>
            <CardHeader className="flex flex-wrap items-center gap-3 space-y-0">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
                <Cpu className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle className="text-sm font-semibold">{t("settings.adapters")}</CardTitle>
                <CardDescription className="mt-1 text-xs">
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
                <RefreshCw className={cn("size-3.5", discoveryRefreshing && "animate-spin")} />
                {discoveryRefreshing ? t("settings.discoveryRefreshing") : t("settings.discoveryRefresh")}
              </Button>
            </CardHeader>
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
                      <AdapterItem key={adapter.id} adapter={adapter} />
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <div className="forgebadger-animate-in" style={{ animationDelay: "160ms" }}>
            <FeishuIntegrationSettings />
          </div>
        </div>

        <div className="space-y-6">
          <Card className="forgebadger-animate-in" style={{ animationDelay: "80ms" }}>
            <SettingsCardHeader
              icon={<ShieldCheck className="size-4" />}
              title={t("settings.securityBaseline")}
              description={t("settings.securityDescription")}
            />
            <CardContent className="space-y-3">
              <div className="divide-y divide-border/70 overflow-hidden rounded-md border border-border/70">
                <SecurityItem label={t("settings.jwtAuth")} value={t("settings.enabled")} />
                <SecurityItem label={t("settings.tenantIsolation")} value={t("settings.enabled")} />
                <SecurityItem label={t("settings.apiKeyEncryption")} value="AES-256-GCM" />
                <SecurityItem label={t("settings.terminalPersistence")} value="tmux" />
              </div>
              <div className="flex items-start gap-2.5 rounded-md border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
                <KeyRound className="mt-0.5 size-3.5 shrink-0" />
                <span>{t("settings.secretsNotice")}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="forgebadger-animate-in" style={{ animationDelay: "120ms" }}>
            <SettingsCardHeader
              icon={<Download className="size-4" />}
              title={t("settings.diagnostics")}
              description={t("settings.diagnosticsDescription")}
            />
            <CardContent className="space-y-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={handleDiagnosticsExport}
                disabled={diagnosticsState === "exporting"}
              >
                <Download className="size-4" />
                {diagnosticsState === "exporting"
                  ? t("settings.diagnosticsExporting")
                  : t("settings.diagnosticsExport")}
              </Button>
              <p
                className={cn(
                  "text-xs",
                  diagnosticsState === "success"
                    ? "text-emerald-400"
                    : diagnosticsState === "error"
                      ? "text-destructive"
                      : "text-muted-foreground"
                )}
              >
                {diagnosticsState === "success"
                  ? t("settings.diagnosticsExported")
                  : diagnosticsState === "error"
                    ? t("settings.diagnosticsExportFailed")
                    : t("settings.diagnosticsNotice")}
              </p>
            </CardContent>
          </Card>

          <Card className="forgebadger-animate-in" style={{ animationDelay: "160ms" }}>
            <SettingsCardHeader
              icon={<ScrollText className="size-4" />}
              title={t("settings.auditHistory")}
              description={t("settings.auditDescription")}
            />
            <CardContent>
              {auditLoading ? (
                <p className="text-xs text-muted-foreground">{t("settings.auditLoading")}</p>
              ) : (auditData?.auditLogs.length ?? 0) === 0 ? (
                <div className="flex flex-col items-center gap-2.5 py-6 text-center">
                  <div className="flex size-9 items-center justify-center rounded-md bg-brand/10 text-brand">
                    <ScrollText className="size-4" />
                  </div>
                  <p className="text-xs text-muted-foreground">{t("settings.auditEmpty")}</p>
                </div>
              ) : (
                <div className="divide-y divide-border/70 overflow-hidden rounded-md border border-border/70">
                  {auditData?.auditLogs.map((entry) => (
                    <div key={entry.id} className="px-3 py-2.5 transition-colors hover:bg-muted/40">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-medium">{entry.action}</span>
                        <Badge variant="outline">{entry.resourceType}</Badge>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function downloadDiagnosticsReport(report: LocalDiagnosticsExport) {
  const generatedAt = report.generatedAt.replace(/[:.]/g, "-");
  const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `forgebadger-diagnostics-${generatedAt}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function SettingsCardHeader({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <CardHeader className="flex flex-row items-center gap-3 space-y-0">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
        {icon}
      </div>
      <div className="min-w-0">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        <CardDescription className="mt-1 text-xs">{description}</CardDescription>
      </div>
    </CardHeader>
  );
}

function AdapterItem({ adapter }: { adapter: AdapterDiscovery }) {
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
      {adapter.runtimeModes.length > 0 && (
        <div className="mt-1.5 font-mono text-xs text-muted-foreground">
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
    <div className="flex items-center justify-between gap-4 rounded-md border border-border/70 px-3 py-3 transition-colors hover:bg-muted/40">
      <div className="flex min-w-0 items-start gap-3">
        {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
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
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Badge variant="secondary">{value}</Badge>
    </div>
  );
}
