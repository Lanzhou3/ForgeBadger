"use client";

import { useEffect, useState } from "react";
import { useUiLocale } from "@/hooks/use-language";
import { Check, Copy, KeyRound } from "lucide-react";

import { SettingsCardHeader } from "@/components/settings/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { ChannelPlatform } from "@/lib/api";
import type { ChannelIdentity, ChannelPairing } from "@/lib/copilot-channels-api";
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
  const locale = useUiLocale();
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
        title={copy.pairingTitle}
        description={copy.pairingDescription}
      />
      <CardContent className="space-y-3">
        <Button disabled={busy || !canPair || queriesError} onClick={onCreatePairing}>{copy.createPairingCode}</Button>
        {token && (
          <div className="space-y-2 rounded-md border border-border/70 p-3">
            <p className="text-sm">{copy.pairingCommandHint(channelName, new Date(token.expiresAt).toLocaleTimeString(locale))}</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="block min-w-0 flex-1 break-all select-all rounded bg-muted/40 px-2 py-1.5 font-mono text-xs">/pair {token.value}</code>
              <Button type="button" variant="outline" size="sm" onClick={() => void copyCommand()}>
                {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                {copied ? copy.commandCopied : copy.copyCommand}
              </Button>
            </div>
          </div>
        )}
        {!pairing && <p className="text-sm text-muted-foreground">{copy.noPendingPairing}</p>}
        {pairing?.status === "pending" && (
          <p role="status" className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary" className="bg-amber-500/15 text-amber-400">{copy.pairingStatusPending}</Badge>
            {copy.waitingClaim(channelName)}
          </p>
        )}
        {pairing?.status === "claimed" && (
          <div className="space-y-3 rounded-md border border-border/70 p-3">
            <p className="text-sm">{copy.claimReviewHint}</p>
            <dl className="break-all text-sm">
              <dt>{channel === "feishu" ? copy.userIdLabelFeishu : copy.userIdLabelTelegram}</dt>
              <dd>{pairing.externalUserId}</dd>
              <dt className="mt-2">{channel === "feishu" ? copy.chatIdLabelFeishu : copy.chatIdLabelTelegram}</dt>
              <dd>{pairing.chatId}</dd>
            </dl>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                aria-label={copy.ackLabel(channelName)}
                checked={ack === candidate}
                onCheckedChange={(checked) => setAck(checked === true ? candidate : "")}
              />
              {copy.ackLabel(channelName)}
            </label>
            <Button disabled={busy || !canPair || queriesError || ack !== candidate} onClick={() => onConfirmPairing(pairing)}>{copy.confirmIdentity}</Button>
          </div>
        )}
        {pairing && (
          <Button variant="outline" disabled={busy} onClick={() => { setAck(""); onCancelPairing(pairing.id); }}>{copy.cancelPairing}</Button>
        )}
        {accountIdentities.length === 0 && (
          <p className="text-sm text-muted-foreground">{copy.identitiesEmpty}</p>
        )}
        {accountIdentities.map((identity) => (
          <div key={identity.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 p-3 text-sm">
            <span className="break-all">
              {identity.externalUserId} · {identity.status === "active" && identity.accountRevision !== accountRevision ? copy.identityStale : (copy.channelStates[identity.status] ?? identity.status)}
            </span>
            <Button variant="outline" size="sm" disabled={busy || identity.status !== "active"} onClick={() => onRevokeIdentity(identity.id)}>{copy.revokeIdentity}</Button>
          </div>
        ))}
        <div id="channel-chat-allowlist" className="space-y-2 rounded-md border border-border/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">{copy.allowlistTitle}</p>
            {!editingWhitelist && (
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setEditingWhitelist(true)}>
                {whitelistIdsText ? copy.editAllowlist : copy.setAllowlist}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{copy.allowlistHint}</p>
          {!editingWhitelist ? (
            whitelistIdsText ? (
              <p className="break-all font-mono text-xs text-muted-foreground">{whitelistIdsText}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{copy.allowlistEmpty}</p>
            )
          ) : (
            <>
              <label className="block space-y-1 text-sm">{copy.allowlistInputLabel}<Input aria-label={copy.allowlistAria} value={whitelistValue} placeholder={channel === "feishu" ? copy.allowlistPlaceholderFeishu : copy.allowlistPlaceholderTelegram} onChange={(e) => setWhitelistDraft(e.target.value)} /></label>
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
                  {copy.saveAllowlist}
                </Button>
              </div>
            </>
          )}
          {whitelistIds.length > 50 && <p role="alert">{copy.allowlistTooMany}</p>}
          {whitelistError && <p role="alert">{copy.allowlistLoadError}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
