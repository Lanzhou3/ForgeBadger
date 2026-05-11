"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, Cpu, Download, FlaskConical, Globe2, KeyRound, ScrollText, ServerCog, Settings2, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  getBrowserNotificationPermission,
  getBrowserNotificationPreference,
  requestBrowserNotificationPermission,
  setBrowserNotificationPreference,
  type BrowserNotificationPermission,
} from "@/lib/browser-notifications";
import { discoverAdapters, exportDiagnostics, listAuditLogs, type AdapterDiscovery, type LocalDiagnosticsExport } from "@/lib/api";
import type { Language } from "@/lib/i18n";

const languageOptions = [
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "en", label: "English" },
];

export default function SettingsPage() {
  const { language, setLanguage, t } = useLanguage();
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(false);
  const [browserNotificationPermission, setBrowserNotificationPermission] =
    useState<BrowserNotificationPermission>("unsupported");
  const [diagnosticsState, setDiagnosticsState] = useState<"idle" | "exporting" | "success" | "error">("idle");
  const { data: adapterData, isLoading: adaptersLoading } = useQuery({
    queryKey: ["adapter-discovery"],
    queryFn: discoverAdapters,
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
              <div className="flex items-center gap-2">
                <Cpu className="size-4 text-muted-foreground" />
                <CardTitle>{t("settings.adapters")}</CardTitle>
              </div>
              <CardDescription>
                {t("settings.adaptersDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {adaptersLoading ? (
                <p className="text-sm text-muted-foreground">
                  {t("settings.discoveryLoading")}
                </p>
              ) : (
                adapterData?.adapters.map((adapter) => (
                  <AdapterItem key={adapter.id} adapter={adapter} />
                ))
              )}
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
