"use client";

import { useEffect, useState } from "react";
import { useUiLocale } from "@/hooks/use-language";
import { Check, ChevronDown, Copy, Plus, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { ChannelPlatform } from "@/lib/api";
import type { ChannelIdentity, ChannelPairing } from "@/lib/copilot-channels-api";
import { ChannelSection } from "./ChannelSection";
import { CopilotStatusBadge } from "./copilot-status-badge";
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
  completed?: boolean;
  muted?: boolean;
  queriesError: boolean;
  pairing: ChannelPairing | undefined;
  token: IssuedPairingToken | null;
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

export function ChannelPairingStep({
  channel, channelName, busy, canPair, completed = false, muted = false, queriesError, pairing, token, candidate,
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
  const savedWhitelistIds = whitelistIdsText.split(/[,，\s]+/).filter(Boolean);

  async function copyCommand() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(`/pair ${token.value}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The selectable command remains available when clipboard access is denied.
    }
  }

  return (
    <ChannelSection
      id="channel-pairing"
      step={2}
      completed={completed}
      muted={muted}
      title={copy.pairingTitle}
      action={
        <Button size="sm" variant="outline" disabled={busy || !canPair || queriesError} onClick={onCreatePairing}>
          <Plus className="size-3.5" />{copy.createPairingCode}
        </Button>
      }
    >
      <div className="space-y-4">
        {accountIdentities.length > 0 && (
          <ul className="space-y-2">
            {accountIdentities.map((identity) => {
              const stale = identity.accountRevision !== accountRevision;
              return (
                <li key={identity.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border/70 px-3 py-2.5 text-sm">
                  <UserRound className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 break-all">{identity.externalUserId}</span>
                  <CopilotStatusBadge tone={stale ? "warning" : "success"} dot={!stale}>
                    {stale ? copy.identityStale : copy.identityPaired}
                  </CopilotStatusBadge>
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => onRevokeIdentity(identity.id)}>{copy.revokeIdentity}</Button>
                </li>
              );
            })}
          </ul>
        )}

        {token && (
          <div className="rounded-md border border-brand/30 bg-brand/5 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <code className="block min-w-0 flex-1 break-all select-all font-mono text-sm">/pair {token.value}</code>
              <Button type="button" variant="outline" size="sm" onClick={() => void copyCommand()}>
                {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                {copied ? copy.commandCopied : copy.copyCommand}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{copy.pairingCommandHint(channelName, new Date(token.expiresAt).toLocaleTimeString(locale))}</p>
          </div>
        )}
        {pairing?.status === "pending" && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="size-2 rounded-full bg-warning forgebadger-pulse-dot" />{copy.waitingClaim(channelName)}
          </p>
        )}
        {pairing?.status === "claimed" && (
          <div className="space-y-3 rounded-md border border-border/70 bg-muted/15 p-3">
            <dl className="grid gap-x-4 gap-y-2 break-all text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">{channel === "feishu" ? copy.userIdLabelFeishu : copy.userIdLabelTelegram}</dt><dd className="mt-1 font-mono text-xs">{pairing.externalUserId}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{channel === "feishu" ? copy.chatIdLabelFeishu : copy.chatIdLabelTelegram}</dt><dd className="mt-1 font-mono text-xs">{pairing.chatId}</dd></div>
            </dl>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox aria-label={copy.ackLabel(channelName)} checked={ack === candidate} onCheckedChange={(checked) => setAck(checked === true ? candidate : "")} />
              {copy.ackLabel(channelName)}
            </label>
            <Button size="sm" disabled={busy || !canPair || queriesError || ack !== candidate} onClick={() => onConfirmPairing(pairing)}>{copy.confirmIdentity}</Button>
          </div>
        )}
        {pairing && (
          <div><Button variant="ghost" size="sm" disabled={busy} onClick={() => { setAck(""); onCancelPairing(pairing.id); }}>{copy.cancelPairing}</Button></div>
        )}

        <details id="channel-chat-allowlist" className="group rounded-md border border-border/70">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex-1 font-medium">{copy.allowlistTitle}</span>
            {savedWhitelistIds.length > 0 && <Badge variant="secondary">{savedWhitelistIds.length}</Badge>}
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-3 border-t border-border/70 p-3">
            <p className="text-xs leading-relaxed text-muted-foreground">{copy.allowlistHint}</p>
            {!editingWhitelist ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 flex-1 break-all font-mono text-xs text-muted-foreground">{whitelistIdsText || copy.allowlistEmpty}</p>
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setEditingWhitelist(true)}>
                  {whitelistIdsText ? copy.editAllowlist : copy.setAllowlist}
                </Button>
              </div>
            ) : (
              <>
                <label className="block space-y-1.5 text-xs font-medium">{copy.allowlistInputLabel}<Input aria-label={copy.allowlistAria} value={whitelistValue} placeholder={channel === "feishu" ? copy.allowlistPlaceholderFeishu : copy.allowlistPlaceholderTelegram} onChange={(e) => setWhitelistDraft(e.target.value)} /></label>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" disabled={busy} onClick={() => { setWhitelistDraft(null); setEditingWhitelist(false); }}>{copy.dialogCancel}</Button>
                  <Button
                    type="button"
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
            {whitelistIds.length > 50 && <p role="alert" className="text-xs text-destructive">{copy.allowlistTooMany}</p>}
            {whitelistError && <p role="alert" className="text-xs text-destructive">{copy.allowlistLoadError}</p>}
          </div>
        </details>
      </div>
    </ChannelSection>
  );
}
