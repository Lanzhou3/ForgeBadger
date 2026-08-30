"use client";

import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/hooks/use-language";
import {
  emergencyStopFeishu,
  getFeishuChannelAccount,
  getFeishuConnectionHealth,
  getFeishuIntegrationConfig,
  saveFeishuChannelAccount,
  updateFeishuIntegrationConfig
} from "@/lib/api";

const HEALTH_BADGE: Record<string, { template: string; labelKey: string }> = {
  connected: { template: "emerald", labelKey: "settings.feishuStateConnected" },
  connecting: { template: "blue", labelKey: "settings.feishuStateConnecting" },
  reconnecting: { template: "amber", labelKey: "settings.feishuStateReconnecting" },
  disabled: { template: "zinc", labelKey: "settings.feishuStateDisabled" },
  unhealthy: { template: "red", labelKey: "settings.feishuStateUnhealthy" },
  stopped: { template: "zinc", labelKey: "settings.feishuStateStopped" }
};

/**
 * Feishu integration management for the Copilot console settings page:
 * bot credentials + enable switch, live connection health, chat allowlist,
 * and the emergency stop. Backed by /api/v1/integrations/feishu/*.
 */
export function FeishuSettingsSection() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const account = useQuery({ queryKey: ["feishu", "account"], queryFn: getFeishuChannelAccount });
  const health = useQuery({
    queryKey: ["feishu", "health"],
    queryFn: getFeishuConnectionHealth,
    refetchInterval: 15_000
  });
  const config = useQuery({ queryKey: ["feishu", "config"], queryFn: getFeishuIntegrationConfig });

  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [allowedChatsDraft, setAllowedChatsDraft] = useState("");
  const [accountError, setAccountError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    if (account.data) {
      setAppId(account.data.appId);
      setEnabled(account.data.enabled);
    }
  }, [account.data]);

  useEffect(() => {
    if (config.data) setAllowedChatsDraft(config.data.allowedChatIds.join("\n"));
  }, [config.data]);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["feishu"] });
  };

  const saveAccount = useMutation({
    mutationFn: () =>
      saveFeishuChannelAccount({
        appId: appId.trim(),
        ...(appSecret.trim() ? { appSecret: appSecret.trim() } : {}),
        enabled
      }),
    onSuccess: () => {
      setAccountError(null);
      setAppSecret("");
      invalidate();
    },
    onError: () => setAccountError(t("copilot.feishuSaveError"))
  });

  const saveChats = useMutation({
    mutationFn: () =>
      updateFeishuIntegrationConfig({
        ...(config.data?.enabled !== undefined ? { enabled: config.data.enabled } : {}),
        allowedChatIds: allowedChatsDraft
          .split(/\n|,/u)
          .map((value) => value.trim())
          .filter(Boolean)
      }),
    onSuccess: () => {
      setConfigError(null);
      invalidate();
    },
    onError: () => setConfigError(t("copilot.feishuConfigError"))
  });

  const emergencyStop = useMutation({
    mutationFn: emergencyStopFeishu,
    onSuccess: invalidate
  });

  const healthState = health.data?.state ?? (config.data?.enabled ? "connecting" : "disabled");
  const badge = HEALTH_BADGE[healthState] ?? { template: "zinc", labelKey: "settings.feishuStateDisabled" as const };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
          {t("settings.feishuIntegration")}
        </p>
        <Badge variant="secondary" className="gap-1.5">
          <span className={`size-1.5 rounded-full bg-${badge.template}-500`} />
          {t(badge.labelKey as Parameters<typeof t>[0])}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">{t("settings.feishuRouting")}</p>

      <div className="space-y-1.5">
        <Label htmlFor="feishu-app-id" className="text-xs font-normal text-muted-foreground">
          {t("settings.feishuAppId")}
        </Label>
        <Input
          id="feishu-app-id"
          value={appId}
          onChange={(event) => setAppId(event.target.value)}
          placeholder="cli_xxx"
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="feishu-app-secret" className="text-xs font-normal text-muted-foreground">
          {t("settings.feishuAppSecret")}
        </Label>
        <Input
          id="feishu-app-secret"
          type="password"
          value={appSecret}
          onChange={(event) => setAppSecret(event.target.value)}
          placeholder={account.data ? t("settings.feishuSecretConfigured") : ""}
          className="h-8 text-sm"
        />
        <p className="text-xs text-muted-foreground/80">{t("settings.feishuSecretWriteOnly")}</p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <Label htmlFor="feishu-enabled" className="text-sm font-normal">
            {t("settings.feishuEnabledLabel")}
          </Label>
          <p className="text-xs text-muted-foreground">{t("settings.feishuEnabledDescription")}</p>
        </div>
        <Switch id="feishu-enabled" size="sm" checked={enabled} onCheckedChange={setEnabled} />
      </div>
      {accountError && <p className="text-xs text-destructive">{accountError}</p>}
      <Button
        size="sm"
        data-testid="feishu-save-account"
        onClick={() => saveAccount.mutate()}
        disabled={saveAccount.isPending || !appId.trim() || (!account.data && !appSecret.trim())}
      >
        {t("settings.feishuSave")}
      </Button>

      <div className="space-y-1.5 border-t border-border/60 pt-3">
        <Label htmlFor="feishu-allowed-chats" className="text-xs font-normal text-muted-foreground">
          {t("settings.feishuAllowedChats")}
        </Label>
        <textarea
          id="feishu-allowed-chats"
          value={allowedChatsDraft}
          onChange={(event) => setAllowedChatsDraft(event.target.value)}
          rows={3}
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
          placeholder={"oc_xxx\noc_yyy"}
        />
        <p className="text-xs text-muted-foreground/80">{t("settings.feishuAllowedChatsHint")}</p>
        <Button
          size="sm"
          variant="outline"
          data-testid="feishu-save-chats"
          disabled={saveChats.isPending || !config.data}
          onClick={() => saveChats.mutate()}
        >
          {t("copilot.feishuSaveChats")}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
        <p className="text-xs text-muted-foreground">{t("settings.feishuEmergencyHint")}</p>
        <Button
          size="sm"
          variant="destructive"
          disabled={emergencyStop.isPending || config.data?.emergencyDisabled === true}
          onClick={() => {
            if (!window.confirm(t("settings.feishuEmergencyConfirm"))) return;
            emergencyStop.mutate();
          }}
        >
          {t("settings.feishuEmergencyStop")}
        </Button>
      </div>
      {config.data?.emergencyDisabled && (
        <Badge variant="outline" className="border-red-500/50 text-red-500">
          {t("settings.feishuEmergencyActive")}
        </Badge>
      )}
      {configError && <p className="text-xs text-destructive">{configError}</p>}
    </section>
  );
}
