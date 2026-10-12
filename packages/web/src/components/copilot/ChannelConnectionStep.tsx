"use client";

import { useEffect, useState } from "react";
import { useUiLocale } from "@/hooks/use-language";
import { Plug } from "lucide-react";

import { SettingsCardHeader } from "@/components/settings/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { useSettingsCopy } from "./settings-copy";

interface ChannelAccountSnapshot {  enabled: boolean;
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

/** Step 1: connect the Feishu app or Telegram bot. Saved credentials render as a
 * read-only summary; the form only expands on demand (or when nothing is saved). */
export function ChannelConnectionStep({ channel, channelName, account, health, busy, onSaveFeishu, onSaveTelegram, onEmergencyStop }: Props) {
  const copy = useSettingsCopy();
  const locale = useUiLocale();
  const configured = !!account?.secretConfigured;
  const [editing, setEditing] = useState(!configured);
  const [wasConfigured, setWasConfigured] = useState(configured);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [botToken, setBotToken] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const healthState = health?.state ?? "disabled";

  // Collapse back into the summary once the first credentials are saved.
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

  const savedBadge = (
    <Badge variant="secondary">
      {channel === "feishu" ? copy.savedBadgeFeishu : copy.savedBadgeTelegram}
    </Badge>
  );

  return (
    <Card id="channel-connection" className="forgebadger-animate-in">
      <SettingsCardHeader
        icon={<Plug className="size-4" />}
        title={channel === "feishu" ? copy.connectionTitleFeishu : copy.connectionTitleTelegram}
        description={copy.connectionDescription}
        action={
          <Badge variant="secondary" className={connectionBadgeClass(healthState)}>
            {copy.channelStates[healthState] ?? healthState}
          </Badge>
        }
      />
      <CardContent className="space-y-3">
        {configured && !editing ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
              {savedBadge}
              {channel === "feishu" && account?.appId && (
                <span className="break-all font-mono text-xs text-muted-foreground">App ID · {account.appId}</span>
              )}
              {channel === "telegram" && account?.botUsername && (
                <span className="text-xs text-muted-foreground">{copy.botUsername(account.botUsername)}</span>
              )}
              {health?.lastConnectedAt && (
                <span className="text-xs text-muted-foreground">{copy.lastConnected(new Date(health.lastConnectedAt).toLocaleString(locale))}</span>
              )}
            </div>
            {health?.lastErrorMessage && (
              <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
                {copy.lastError(health.lastErrorMessage)}
              </div>
            )}
            <div>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setEditing(true)}>
                {copy.modifyConfig}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {configured ? savedBadge : (
                <Badge variant="outline">
                  {channel === "feishu" ? copy.notConfiguredBadgeFeishu : copy.notConfiguredBadgeTelegram}
                </Badge>
              )}
            </div>
            {health?.lastConnectedAt && (
              <p className="text-xs text-muted-foreground">{copy.lastConnected(new Date(health.lastConnectedAt).toLocaleString(locale))}</p>
            )}
            {health?.lastErrorMessage && (
              <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
                {copy.lastError(health.lastErrorMessage)}
              </div>
            )}
            {channel === "feishu" && (
              <form
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const submittedSecret = appSecret;
                  void onSaveFeishu(appId || account?.appId || "", submittedSecret).then((saved) => {
                    setAppSecret("");
                    if (saved) {
                      setAppId("");
                      setEditing(false);
                    }
                  });
                }}
              >
                <label className="space-y-1 text-sm">App ID<Input aria-label="App ID" autoComplete="off" value={appId} placeholder={account?.appId ?? "cli_…"} onChange={(e) => setAppId(e.target.value)} /></label>
                <label className="space-y-1 text-sm">App Secret<Input aria-label="App Secret" type="password" autoComplete="new-password" value={appSecret} placeholder={configured ? copy.secretKeepPlaceholder : copy.secretInputPlaceholder} onChange={(e) => setAppSecret(e.target.value)} /></label>
                <div className="flex justify-end gap-2 sm:col-span-2">
                  <Button type="button" variant="ghost" disabled={busy} onClick={cancelEditing}>{copy.dialogCancel}</Button>
                  <Button type="submit" disabled={busy || !(appId || account?.appId) || (!configured && !appSecret)}>{copy.saveAndEnable}</Button>
                </div>
              </form>
            )}
            {channel === "telegram" && (
              <form
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const submittedToken = botToken;
                  void onSaveTelegram(submittedToken).then((saved) => {
                    setBotToken("");
                    if (saved) setEditing(false);
                  });
                }}
              >
                <label className="space-y-1 text-sm">Bot Token<Input aria-label="Bot Token" type="password" autoComplete="new-password" value={botToken} placeholder={configured ? copy.tokenKeepPlaceholder : "123456:ABC-DEF…"} onChange={(e) => setBotToken(e.target.value)} /></label>
                <div className="flex items-end justify-end gap-2">
                  <Button type="button" variant="ghost" disabled={busy} onClick={cancelEditing}>{copy.dialogCancel}</Button>
                  <Button type="submit" disabled={busy || (!botToken && !configured)}>{copy.saveAndEnable}</Button>
                </div>
              </form>
            )}
          </>
        )}
        {channel === "feishu" && (
          <>
            <p className="text-xs text-muted-foreground">{copy.feishuReconnectHint}</p>
            <p className="text-xs text-muted-foreground">{copy.feishuPlatformHint}</p>
            <p className="text-xs text-muted-foreground">{copy.feishuCardHint}</p>
          </>
        )}
        <div className="space-y-2 border-t border-border/70 pt-3">
          <p className="text-xs text-muted-foreground">{copy.emergencyStopNote(channel === "telegram")}</p>
          <Button type="button" variant="outline" className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy || !account} onClick={() => setConfirmStop(true)}>
            {copy.emergencyStopButton(channelName)}
          </Button>
        </div>
      </CardContent>
      <Dialog open={confirmStop} onOpenChange={setConfirmStop}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.emergencyStopTitle(channelName)}</DialogTitle>
            <DialogDescription>{copy.emergencyStopDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmStop(false)}>{copy.dialogCancel}</Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setConfirmStop(false);
                onEmergencyStop();
              }}
            >
              {copy.emergencyStopConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
