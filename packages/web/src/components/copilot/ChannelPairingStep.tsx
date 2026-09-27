"use client";

import { useEffect, useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";

import { SettingsCardHeader } from "@/components/settings/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { ChannelPlatform } from "@/lib/api";
import type { ChannelIdentity, ChannelPairing } from "@/lib/copilot-channels-api";
import { channelStateLabel } from "./channel-setup";
import { useSettingsCopy } from "./settings-copy";

export interface IssuedPairingToken {
  value: string;
  expiresAt: number;
}

interface Props {
  channel: ChannelPlatform;
  channelName: string;
  busy: boolean;
  canPair: boolean;
  queriesError: boolean;
  pairing: ChannelPairing | undefined;
  /** One-time token currently on screen (only while valid and unclaimed). */
  token: IssuedPairingToken | null;
  /** Revision fingerprint of the active pairing; acknowledgement is tied to it. */
  candidate: string;
  accountIdentities: ChannelIdentity[];
  accountRevision: number | undefined;
  onCreatePairing: () => void;
  onConfirmPairing: (pairing: ChannelPairing) => void;
  onCancelPairing: (id: string) => void;
  onRevokeIdentity: (id: string) => void;
  whitelistIdsText: string;
  whitelistLoading: boolean;
  whitelistError: boolean;
  onSaveWhitelist: (ids: string[]) => Promise<boolean>;
}

/** Step 2: issue pairing codes, confirm the private-chat identity, manage the chat allowlist. */
export function ChannelPairingStep({
  channel, channelName, busy, canPair, queriesError, pairing, token, candidate,
  accountIdentities, accountRevision, onCreatePairing, onConfirmPairing, onCancelPairing,
  onRevokeIdentity, whitelistIdsText, whitelistLoading, whitelistError, onSaveWhitelist,
}: Props) {
  const copy = useSettingsCopy();
  const [ack, setAck] = useState("");
  const [whitelistDraft, setWhitelistDraft] = useState<string | null>(null);
  const [editingWhitelist, setEditingWhitelist] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => setAck(""), [candidate]);

  const whitelistValue = whitelistDraft ?? whitelistIdsText;
  const whitelistIds = [...new Set((whitelistDraft ?? "").split(/[,，\s]+/).filter(Boolean))];

  async function copyCommand() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(`/pair ${token.value}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (or denied): the code block keeps select-all.
    }
  }

  return (
    <Card id="channel-pairing" className="forgebadger-animate-in">
      <SettingsCardHeader
        icon={<KeyRound className="size-4" />}
        title="2. 确认私聊身份"
        description="连接成功后，还需确认哪个私聊用户可以操作项目。发送配对命令后，请回到此处确认身份。"
      />
      <CardContent className="space-y-3">
        <Button disabled={busy || !canPair || queriesError} onClick={onCreatePairing}>生成新的配对码</Button>
        {token && (
          <div className="space-y-2 rounded-md border border-border/70 p-3">
            <p className="text-sm">向{channelName}机器人私聊发送以下命令，请勿转发。到期：{new Date(token.expiresAt).toLocaleTimeString()}</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="block min-w-0 flex-1 break-all select-all rounded bg-muted/40 px-2 py-1.5 font-mono text-xs">/pair {token.value}</code>
              <Button type="button" variant="outline" size="sm" onClick={() => void copyCommand()}>
                {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                {copied ? copy.commandCopied : copy.copyCommand}
              </Button>
            </div>
          </div>
        )}
        {!pairing && <p className="text-sm text-muted-foreground">没有待确认配对。新配对码会使旧码失效。</p>}
        {pairing?.status === "pending" && (
          <p role="status" className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary" className="bg-amber-500/15 text-amber-400">待处理</Badge>
            等待{channelName}私聊认领… 配对码仅在生成时显示，刷新页面后可重新生成。
          </p>
        )}
        {pairing?.status === "claimed" && (
          <div className="space-y-3 rounded-md border border-border/70 p-3">
            <p className="text-sm">请核对认领者，勾选后确认；系统不会自动绑定身份。</p>
            <dl className="break-all text-sm">
              <dt>{channel === "feishu" ? "飞书用户 ID" : "Telegram 用户 ID"}</dt>
              <dd>{pairing.externalUserId}</dd>
              <dt className="mt-2">{channel === "feishu" ? "私聊 ID" : "会话 ID"}</dt>
              <dd>{pairing.chatId}</dd>
            </dl>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                aria-label={`我确认这是自己的${channelName}私聊`}
                checked={ack === candidate}
                onCheckedChange={(checked) => setAck(checked === true ? candidate : "")}
              />
              我确认这是自己的{channelName}私聊
            </label>
            <Button disabled={busy || !canPair || queriesError || ack !== candidate} onClick={() => onConfirmPairing(pairing)}>确认身份</Button>
          </div>
        )}
        {pairing && (
          <Button variant="outline" disabled={busy} onClick={() => { setAck(""); onCancelPairing(pairing.id); }}>取消本次配对</Button>
        )}
        {accountIdentities.length === 0 && (
          <p className="text-sm text-muted-foreground">{copy.identitiesEmpty}</p>
        )}
        {accountIdentities.map((identity) => (
          <div key={identity.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 p-3 text-sm">
            <span className="break-all">
              {identity.externalUserId} · {identity.status === "active" && identity.accountRevision !== accountRevision ? "已失效，需重新配对" : channelStateLabel(identity.status)}
            </span>
            <Button variant="outline" size="sm" disabled={busy || identity.status !== "active"} onClick={() => onRevokeIdentity(identity.id)}>撤销身份</Button>
          </div>
        ))}
        <div id="channel-chat-allowlist" className="space-y-2 rounded-md border border-border/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">聊天白名单（群聊与私聊）</p>
            {!editingWhitelist && (
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setEditingWhitelist(true)}>
                {whitelistIdsText ? copy.editAllowlist : copy.setAllowlist}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">群聊默认拒绝；加入白名单后，机器人在该群内被 @ 才会响应。注意：白名单非空时，不在名单内的私聊也会被拒绝，需要把自己的私聊 ID 一并加入。</p>
          {!editingWhitelist ? (
            whitelistIdsText ? (
              <p className="break-all font-mono text-xs text-muted-foreground">{whitelistIdsText}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{copy.allowlistEmpty}</p>
            )
          ) : (
            <>
              <label className="block space-y-1 text-sm">群聊与私聊 ID（逗号分隔，最多 50 个）<Input aria-label="群聊白名单" value={whitelistValue} placeholder={channel === "feishu" ? "例如：oc_群聊ID,oc_私聊ID" : "例如：-1001234567890,123456789"} onChange={(e) => setWhitelistDraft(e.target.value)} /></label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setWhitelistDraft(null);
                    setEditingWhitelist(false);
                  }}
                >
                  {copy.dialogCancel}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || whitelistLoading || whitelistError || whitelistIds.length > 50 || whitelistDraft === null || whitelistDraft === whitelistIdsText}
                  onClick={() => {
                    void onSaveWhitelist(whitelistIds).then((saved) => {
                      if (saved) {
                        setWhitelistDraft(null);
                        setEditingWhitelist(false);
                      }
                    });
                  }}
                >
                  保存白名单
                </Button>
              </div>
            </>
          )}
          {whitelistIds.length > 50 && <p role="alert">最多允许 50 个聊天 ID，请减少后再保存。</p>}
          {whitelistError && <p role="alert">白名单加载失败，请稍后重试。</p>}
        </div>
      </CardContent>
    </Card>
  );
}
