"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Pencil, Plug } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ChannelPlatform } from "@/lib/api";
import { connectionBadgeClass } from "./channel-setup";
import { ChannelSection } from "./ChannelSection";
import { useSettingsCopy } from "./settings-copy";

interface ChannelAccountSnapshot {
  enabled: boolean;
  secretConfigured: boolean;
  appId?: string | null;
  botUsername?: string | null;
}

interface ChannelHealthSnapshot {
  state: string;
  lastConnectedAt: string | null;
  lastErrorMessage: string | null;
}

interface Props {
  channel: ChannelPlatform;
  channelName: string;
  account: ChannelAccountSnapshot | null;
  health: ChannelHealthSnapshot | null;
  busy: boolean;
  onSaveFeishu: (appId: string, appSecret: string) => Promise<boolean>;
  onSaveTelegram: (botToken: string) => Promise<boolean>;
  onEmergencyStop: () => void;
}

export function ChannelConnectionStep({ channel, channelName, account, health, busy, onSaveFeishu, onSaveTelegram, onEmergencyStop }: Props) {
  const copy = useSettingsCopy();
  const configured = !!account?.secretConfigured;
  const [editing, setEditing] = useState(!configured);
  const [wasConfigured, setWasConfigured] = useState(configured);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [botToken, setBotToken] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const healthState = health?.state ?? "disabled";

  useEffect(() => {
    if (configured === wasConfigured) return;
    setWasConfigured(configured);
    if (configured) setEditing(false);
  }, [configured, wasConfigured]);

  function cancelEditing() {
    setEditing(false);
    setAppId("");
    setAppSecret("");
    setBotToken("");
  }

  return (
    <ChannelSection
      id="channel-connection"
      step={1}
      title={channel === "feishu" ? copy.connectionTitleFeishu : copy.connectionTitleTelegram}
      action={
        <Badge variant="secondary" className={connectionBadgeClass(healthState)}>
          {copy.channelStates[healthState] ?? healthState}
        </Badge>
      }
    >
      <div className="space-y-4">
        {configured && !editing ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">{channel === "feishu" ? "App ID" : copy.botUsername(account?.botUsername ?? "")}</p>
              {channel === "feishu" && <p className="mt-1 break-all font-mono text-sm">{account?.appId}</p>}
            </div>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" />{copy.modifyConfig}
            </Button>
          </div>
        ) : (
          <>
            {channel === "feishu" && (
              <form
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void onSaveFeishu(appId || account?.appId || "", appSecret).then((saved) => {
                    setAppSecret("");
                    if (saved) {
                      setAppId("");
                      setEditing(false);
                    }
                  });
                }}
              >
                <label className="space-y-1.5 text-xs font-medium">App ID<Input aria-label="App ID" autoComplete="off" value={appId} placeholder={account?.appId ?? "cli_…"} onChange={(e) => setAppId(e.target.value)} /></label>
                <label className="space-y-1.5 text-xs font-medium">App Secret<Input aria-label="App Secret" type="password" autoComplete="new-password" value={appSecret} placeholder={configured ? copy.secretKeepPlaceholder : copy.secretInputPlaceholder} onChange={(e) => setAppSecret(e.target.value)} /></label>
                <div className="flex justify-end gap-2 sm:col-span-2">
                  {configured && <Button type="button" variant="ghost" disabled={busy} onClick={cancelEditing}>{copy.dialogCancel}</Button>}
                  <Button type="submit" disabled={busy || !(appId || account?.appId) || (!configured && !appSecret)}>{copy.saveAndEnable}</Button>
                </div>
              </form>
            )}
            {channel === "telegram" && (
              <form
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
                onSubmit={(event) => {
                  event.preventDefault();
                  void onSaveTelegram(botToken).then((saved) => {
                    setBotToken("");
                    if (saved) setEditing(false);
                  });
                }}
              >
                <label className="flex-1 space-y-1.5 text-xs font-medium">Bot Token<Input aria-label="Bot Token" type="password" autoComplete="new-password" value={botToken} placeholder={configured ? copy.tokenKeepPlaceholder : "123456:ABC-DEF…"} onChange={(e) => setBotToken(e.target.value)} /></label>
                <div className="flex justify-end gap-2">
                  {configured && <Button type="button" variant="ghost" disabled={busy} onClick={cancelEditing}>{copy.dialogCancel}</Button>}
                  <Button type="submit" disabled={busy || (!botToken && !configured)}>{copy.saveAndEnable}</Button>
                </div>
              </form>
            )}
          </>
        )}
        {health?.lastErrorMessage && (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {copy.lastError(health.lastErrorMessage)}
          </div>
        )}
        <details className="group border-t border-border/70 pt-3">
          <summary className="flex min-h-7 cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Plug className="size-3.5" />
            <span className="flex-1">{copy.channelAdvancedSettings}</span>
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-3 pt-3">
            {channel === "feishu" && (
              <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
                <p>{copy.feishuReconnectHint}</p>
                <p>{copy.feishuPlatformHint}</p>
                <p>{copy.feishuCardHint}</p>
              </div>
            )}
            {account && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
                <p className="text-xs text-muted-foreground">{copy.emergencyStopNote(channel === "telegram")}</p>
                <Button type="button" variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy} onClick={() => setConfirmStop(true)}>
                  {copy.emergencyStopButton(channelName)}
                </Button>
              </div>
            )}
          </div>
        </details>
      </div>
      <Dialog open={confirmStop} onOpenChange={setConfirmStop}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.emergencyStopTitle(channelName)}</DialogTitle>
            <DialogDescription>{copy.emergencyStopDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button autoFocus variant="outline" onClick={() => setConfirmStop(false)}>{copy.dialogCancel}</Button>
            <Button variant="destructive" disabled={busy} onClick={() => { setConfirmStop(false); onEmergencyStop(); }}>
              {copy.emergencyStopConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ChannelSection>
  );
}
