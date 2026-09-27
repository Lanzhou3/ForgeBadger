"use client";

import { useEffect, useState } from "react";
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
import { channelStateLabel, connectionBadgeClass } from "./channel-setup";
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

/** Step 1: connect the Feishu app or Telegram bot. Saved credentials render as a
 * read-only summary; the form only expands on demand (or when nothing is saved). */
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
      {channel === "feishu" ? "凭证已保存" : "Bot Token 已保存"}
    </Badge>
  );

  return (
    <Card id="channel-connection" className="forgebadger-animate-in">
      <SettingsCardHeader
        icon={<Plug className="size-4" />}
        title={channel === "feishu" ? "1. 接入飞书应用" : "1. 接入 Telegram 机器人"}
        description="本步骤连接机器人；完成第 2 步身份确认和第 3 步项目授权后，才能远程操作。"
        action={
          <Badge variant="secondary" className={connectionBadgeClass(healthState)}>
            {channelStateLabel(healthState)}
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
                <span className="text-xs text-muted-foreground">机器人 @{account.botUsername}</span>
              )}
              {health?.lastConnectedAt && (
                <span className="text-xs text-muted-foreground">最近连接：{new Date(health.lastConnectedAt).toLocaleString()}</span>
              )}
            </div>
            {health?.lastErrorMessage && (
              <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
                最近错误：{health.lastErrorMessage}
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
                  {channel === "feishu" ? "尚未配置凭证" : "尚未配置 Bot Token"}
                </Badge>
              )}
            </div>
            {health?.lastConnectedAt && (
              <p className="text-xs text-muted-foreground">最近连接：{new Date(health.lastConnectedAt).toLocaleString()}</p>
            )}
            {health?.lastErrorMessage && (
              <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
                最近错误：{health.lastErrorMessage}
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
                <label className="space-y-1 text-sm">App Secret<Input aria-label="App Secret" type="password" autoComplete="new-password" value={appSecret} placeholder={configured ? "留空保留已保存密钥" : "输入应用密钥"} onChange={(e) => setAppSecret(e.target.value)} /></label>
                <div className="flex justify-end gap-2 sm:col-span-2">
                  <Button type="button" variant="ghost" disabled={busy} onClick={cancelEditing}>取消</Button>
                  <Button type="submit" disabled={busy || !(appId || account?.appId) || (!configured && !appSecret)}>保存并启用</Button>
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
                <label className="space-y-1 text-sm">Bot Token<Input aria-label="Bot Token" type="password" autoComplete="new-password" value={botToken} placeholder={configured ? "留空保留已保存 Token" : "123456:ABC-DEF…"} onChange={(e) => setBotToken(e.target.value)} /></label>
                <div className="flex items-end justify-end gap-2">
                  <Button type="button" variant="ghost" disabled={busy} onClick={cancelEditing}>取消</Button>
                  <Button type="submit" disabled={busy || (!botToken && !configured)}>保存并启用</Button>
                </div>
              </form>
            )}
          </>
        )}
        {channel === "feishu" && (
          <>
            <p className="text-xs text-muted-foreground">更换应用凭证或重新启用后需要重新配对和绑定；保存相同配置会保留已有授权。</p>
            <p className="text-xs text-muted-foreground">飞书开放平台需开启机器人，事件订阅选择长连接并订阅 im.message.receive_v1，配置消息接收与机器人发送权限，发布应用版本并确认自己的账号在应用可用范围内。</p>
            <p className="text-xs text-muted-foreground">在「事件与回调 → 回调配置」中选择长连接，并添加「卡片回传交互」card.action.trigger，才能直接在飞书审批卡片中批准或拒绝操作。仅任务发起人可审批；Web Copilot 仍可处理同一审批。</p>
          </>
        )}
        <div className="space-y-2 border-t border-border/70 pt-3">
          <p className="text-xs text-muted-foreground">紧急停止阻止后续入站和操作；已经发生的操作无法撤回。{channel === "telegram" ? "Telegram 机器人通过长轮询接收消息，无需公网回调地址。" : ""}</p>
          <Button type="button" variant="outline" className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy || !account} onClick={() => setConfirmStop(true)}>
            紧急停止{channelName}
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
