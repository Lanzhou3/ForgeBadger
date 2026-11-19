"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ChevronDown, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { GatewayApiError } from "@/lib/api";
import { getFeishuNotificationSettings, saveFeishuNotificationSettings, getFeishuNotificationDeliveries, testFeishuNotification, refreshFeishuNotificationTargets,
  type FeishuNotificationType, type FeishuNotificationTarget } from "@/lib/feishu-notifications-api";
import { getTelegramNotificationSettings, saveTelegramNotificationSettings, getTelegramNotificationDeliveries, testTelegramNotification } from "@/lib/telegram-notifications-api";
import { ChannelSection } from "./ChannelSection";
import { useSettingsCopy } from "./settings-copy";

export type NotificationChannel = "feishu" | "telegram";
interface Props { channel: NotificationChannel; available: boolean }
interface NotificationConfig { enabled: boolean; targetId: string | null; types: FeishuNotificationType[]; webBaseUrl: string; revision: number }
type NotificationTarget = Pick<FeishuNotificationTarget, "id" | "kind" | "name" | "available" | "reason">;
interface NotificationState { config: NotificationConfig; ready: boolean; blocker: string | null; targets: NotificationTarget[] }
interface ChannelApi {
  get: () => Promise<NotificationState>;
  save: (config: NotificationConfig) => Promise<NotificationState>;
  deliveries: () => Promise<{ deliveries: { id: string; type: FeishuNotificationType | "test"; status: string; errorCode: string | null; createdAt: number }[] }>;
  test: (requestId: string) => Promise<{ id: string; status: string }>;
  refresh?: () => Promise<{ targets: NotificationTarget[] }>;
}
const privateIdentity = (targetId: string | null) => targetId?.startsWith("private:") ? targetId.slice(8) : null;
const apis: Record<NotificationChannel, ChannelApi> = {
  feishu: {
    get: () => getFeishuNotificationSettings(),
    save: config => saveFeishuNotificationSettings({ ...config, identityId: privateIdentity(config.targetId) }),
    deliveries: () => getFeishuNotificationDeliveries(), test: requestId => testFeishuNotification(requestId), refresh: () => refreshFeishuNotificationTargets(),
  },
  telegram: {
    get: () => getTelegramNotificationSettings(),
    save: ({ enabled, targetId, types, webBaseUrl, revision }) => saveTelegramNotificationSettings({ enabled, targetId, types, webBaseUrl, revision }),
    deliveries: () => getTelegramNotificationDeliveries(), test: requestId => testTelegramNotification(requestId),
  },
};
const choiceOrder: FeishuNotificationType[] = ["attention", "failure", "completion", "lifecycle", "app_action", "automation"];

export function ChannelNotificationSettings({ channel, available }: Props) {
  const base = useSettingsCopy();
  const copy = channel === "telegram" ? { ...base, ...base.notifyTelegram, notifyStatuses: { ...base.notifyStatuses, ...base.notifyTelegram.notifyStatuses },
    notifyBlockers: { ...base.notifyBlockers, ...base.notifyTelegram.notifyBlockers } } : base;
  const api = apis[channel];
  const key = [`${channel}-notification-settings`], deliveryKey = [`${channel}-notification-deliveries`];
  const client = useQueryClient();
  const query = useQuery({ queryKey: key, queryFn: api.get, refetchInterval: available ? 15000 : false, refetchIntervalInBackground: false });
  const deliveries = useQuery({ queryKey: deliveryKey, queryFn: api.deliveries, refetchInterval: available ? 15000 : false, refetchIntervalInBackground: false });
  const [draft, setDraft] = useState<NotificationConfig | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const errorMessages: Record<string, string> = { ...copy.notifyBlockers, ...copy.notifyErrors };
  const choices: { type: FeishuNotificationType; label: string }[] = choiceOrder.map(type => ({ type, label: copy.notifyTypes[type] }));
  const reportError = (cause: unknown, action: string) => {
    const code = cause instanceof GatewayApiError && typeof cause.details?.code === "string" ? cause.details.code : "";
    setErrorCode(code);
    const message = errorMessages[code] ?? (cause instanceof GatewayApiError && cause.status === 401 ? copy.notifyAuthExpired : copy.notifyGenericError);
    setError(copy.notifyActionFailed(action, message));
  };
  const config = draft ?? query.data?.config;
  const targets = query.data?.targets ?? [];
  const privateTargets = targets.filter(target => target.kind === "private" && target.available);
  const selected = config?.targetId ?? (privateTargets.length === 1 ? privateTargets[0]!.id : "");
  const selectedTarget = targets.find(target => target.id === selected);
  const withTarget = (value: NotificationConfig, targetId = selected) => ({ ...value, targetId: targetId || null });
  const patch = (input: Partial<NotificationConfig>) => { if (config) setDraft(withTarget({ ...config, ...input }, input.targetId === undefined ? selected : input.targetId ?? "")); };
  const refresh = async () => {
    if (!api.refresh) return;
    setBusy(true); setError(""); setErrorCode(""); setNotice("");
    try {
      const result = await api.refresh(); await query.refetch();
      setNotice(result.targets.some(target => target.kind === "group" && target.available) ? copy.notifyRefreshOk : copy.notifyRefreshNoGroup);
    } catch (cause) { reportError(cause, copy.notifyActionRefresh); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!config) return;
    setBusy(true); setError(""); setErrorCode(""); setNotice("");
    try {
      const saved = await api.save(withTarget(config)); client.setQueryData(key, saved); setDraft(null);
      setNotice(saved.config.enabled ? copy.notifySavedOn : copy.notifySavedOff); await client.invalidateQueries({ queryKey: deliveryKey });
    } catch (cause) { reportError(cause, copy.notifyActionSave); }
    finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setError(""); setErrorCode(""); setNotice("");
    try { await api.test(crypto.randomUUID()); setNotice(copy.notifyTestQueued); await client.invalidateQueries({ queryKey: deliveryKey }); }
    catch (cause) { reportError(cause, copy.notifyActionTest); }
    finally { setBusy(false); }
  };

  return (
    <ChannelSection
      id={`${channel}-notifications`}
      icon={<Bell className="size-4" />}
      title={copy.notifyTitle}
      action={config && <Switch aria-label={copy.notifySwitchAria} checked={config.enabled} disabled={busy || query.isError || (!config.enabled && (!available || !targets.some(target => target.available)))} onCheckedChange={checked => patch({ enabled: checked })} />}
    >
      <div className="space-y-4">
        {query.isPending && <p role="status" className="text-sm text-muted-foreground">{copy.notifyLoading}</p>}
        {query.isError && <p role="alert" className="text-sm text-destructive">{copy.notifyLoadError}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {(errorCode === "CONFIG_CONFLICT" || query.isError) && <Button variant="outline" disabled={busy} onClick={() => { setDraft(null); setError(""); setErrorCode(""); void query.refetch(); }}>{copy.notifyReload}</Button>}
        {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
        {config && (
          <>
            <div className="flex items-center gap-2">
              <Select value={selected} disabled={busy || query.isError} onValueChange={value => patch({ targetId: value || null })}>
                <SelectTrigger aria-label={copy.notifyTargetLabel} className="w-full min-w-0 flex-1"><SelectValue placeholder={copy.notifyTargetPlaceholder} /></SelectTrigger>
                <SelectContent>
                  {selected && !selectedTarget && <SelectItem value={selected}>{copy.notifyTargetStale}</SelectItem>}
                  {targets.map(target => <SelectItem key={target.id} value={target.id} disabled={!target.available}>{target.kind === "group" ? copy.notifyKindGroup : copy.notifyKindPrivate} · {target.name}{target.available ? "" : ` · ${copy.notifyUnavailableSuffix}`}</SelectItem>)}
                </SelectContent>
              </Select>
              {api.refresh && <Button variant="outline" size="icon" aria-label={copy.notifyRefreshTargets} title={copy.notifyRefreshTargets} disabled={busy || !available} onClick={() => void refresh()}><RefreshCw className="size-4" /></Button>}
            </div>
            {selectedTarget?.kind === "group" && <p role="note" className="break-words text-xs text-muted-foreground">{copy.notifyGroupNotice(selectedTarget.name)}</p>}
            <fieldset disabled={busy || query.isError} className="grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">{copy.notifyTypesLegend}</legend>
              {choices.map(choice => (
                <label key={choice.type} className="flex min-h-9 items-center gap-2 rounded-md border border-border/70 px-3 text-sm">
                  <Checkbox aria-label={choice.label} checked={config.types.includes(choice.type)} onCheckedChange={checked => patch({ types: checked === true ? [...config.types, choice.type] : config.types.filter(t => t !== choice.type) })} />
                  {choice.label}
                </label>
              ))}
            </fieldset>
            <details className="group border-y border-border/70 py-3">
              <summary className="flex min-h-7 cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex-1">{copy.notifyWebLabel}</span><ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-2 pt-3">
                <Input aria-label={copy.notifyWebAria} value={config.webBaseUrl} placeholder="https://forge.example.com" disabled={busy || query.isError} onChange={e => patch({ webBaseUrl: e.target.value })} />
                <p className="text-xs leading-relaxed text-muted-foreground">{copy.notifyWebHint}</p>
              </div>
            </details>
            {!draft && query.data?.blocker && <p className="text-sm text-muted-foreground">{copy.notifyBlockers[query.data.blocker] ?? copy.notifyBlockerFallback}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" disabled={busy || !!draft || query.isError || !query.data?.config.enabled || !query.data?.ready} onClick={() => void test()}>{copy.notifyTest}</Button>
              <Button disabled={busy || query.isError || (config.enabled && (!selectedTarget?.available || !config.types.length))} onClick={() => void save()}>{copy.notifySave}</Button>
            </div>
          </>
        )}
        <details className="group rounded-md border border-border/70">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex-1 font-medium">{copy.notifyDeliveriesTitle}</span>
            {!!deliveries.data?.deliveries.length && <Badge variant="secondary">{deliveries.data.deliveries.length}</Badge>}
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-1 border-t border-border/70 p-3 text-sm">
            {deliveries.isPending && <p className="text-muted-foreground">{copy.notifyDeliveriesLoading}</p>}
            {deliveries.isError && <p role="alert" className="text-destructive">{copy.notifyDeliveriesLoadError}</p>}
            {deliveries.data?.deliveries.length === 0 && <p className="text-muted-foreground">{copy.notifyDeliveriesEmpty}</p>}
            {deliveries.data?.deliveries.map(item => (
              <div key={item.id} className="flex flex-wrap justify-between gap-2 rounded-md px-2 py-2 hover:bg-muted/20">
                <span>{item.type === "test" ? copy.notifyTestCard : choices.find(c => c.type === item.type)?.label ?? copy.notifyDeliveryFallback} · {copy.notifyStatuses[item.status] ?? item.status}</span>
                <time className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</time>
                {item.errorCode && errorMessages[item.errorCode] && <p className="w-full text-xs text-muted-foreground">{errorMessages[item.errorCode]}</p>}
              </div>
            ))}
            <p className="px-2 pb-1 pt-2 text-xs leading-relaxed text-muted-foreground">{copy.notifyDeliveriesHint}</p>
          </div>
        </details>
      </div>
    </ChannelSection>
  );
}
