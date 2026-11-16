"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, MessageSquare, Unlink } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ChannelIdentity, ChannelRoute } from "@/lib/copilot-channels-api";
import { DESTRUCTIVE_ROUTE_STATES, type ChannelRouteStateKey, type SetupBlocker } from "./channel-setup";
import { ChannelSection } from "./ChannelSection";
import { useSettingsCopy } from "./settings-copy";

interface Props {
  busy: boolean;
  queriesError: boolean;
  channelName: string;
  identities: ChannelIdentity[];
  identityId: string;
  onIdentityChange: (id: string) => void;
  blocker: SetupBlocker | undefined;
  activationReason: string;
  showBlockerLink: boolean;
  onActivate: () => void;
  routes: ChannelRoute[];
  routeState: (route: ChannelRoute) => ChannelRouteStateKey | null;
  onRevokeRoute: (id: string) => void;
}

function routeBadgeClass(state: ChannelRouteStateKey | null): string {
  if (state === "authorized") return "bg-emerald-500/10 text-emerald-400";
  if (state === "pending_review") return "bg-amber-500/10 text-amber-400";
  if (state && DESTRUCTIVE_ROUTE_STATES.includes(state)) return "bg-destructive/10 text-destructive";
  return "text-muted-foreground";
}

export function ChannelBindingStep({
  busy, queriesError, channelName, identities, identityId, onIdentityChange,
  blocker, activationReason, showBlockerLink, onActivate, routes, routeState, onRevokeRoute,
}: Props) {
  const copy = useSettingsCopy();
  const [pendingRevoke, setPendingRevoke] = useState<ChannelRoute | null>(null);
  const identityHasRoute = routes.some((route) => route.identityId === identityId);

  return (
    <ChannelSection id="channel-authorization" step={3} title={copy.bindingTitle}>
      <div className="space-y-4">
        {routes.length > 0 && (
          <ul className="space-y-2">
            {routes.map((route) => {
              const stateKey = routeState(route);
              return (
                <li key={route.id} className="rounded-md border border-border/70 bg-muted/15 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <span className="hidden size-9 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground sm:flex">
                      <MessageSquare className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="whitespace-nowrap text-sm font-medium">{copy.channelConversation(channelName)}</p>
                        <Badge variant="secondary" className={routeBadgeClass(stateKey)}>
                          {stateKey ? copy.routeStates[stateKey] : (copy.channelStates[route.status] ?? route.status)}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {route.projectId ?? copy.routeProjectMissing}
                      </p>
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      <Button asChild size="sm">
                        <Link href={`/copilot?c=${encodeURIComponent(route.conversationId)}`}>
                          {copy.openConversation}
                          <ArrowUpRight className="size-3.5" />
                        </Link>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        disabled={busy}
                        onClick={() => setPendingRevoke(route)}
                      >
                        <Unlink className="size-3.5" />
                        {copy.revokeBinding}
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {!identityHasRoute && (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select value={identityId} onValueChange={onIdentityChange}>
                <SelectTrigger aria-label={copy.identityLabel} className="w-full sm:max-w-xs">
                  <SelectValue placeholder={copy.identityPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {identities.map((identity) => (
                    <SelectItem key={identity.id} value={identity.id}>{identity.externalUserId}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button aria-describedby={blocker ? "channel-activation-reason" : undefined} disabled={busy || !!blocker || queriesError} onClick={onActivate}>
                {copy.activateRemote(channelName)}
              </Button>
            </div>
            {blocker && (
              <p id="channel-activation-reason" data-testid="channel-activation-reason" role="status" className="text-xs text-muted-foreground">
                {activationReason}
                {showBlockerLink && (
                  <a className="ml-2 underline underline-offset-4" href={`#channel-${blocker.step}`}>{blocker.action}</a>
                )}
              </p>
            )}
          </div>
        )}
      </div>

      <Dialog open={!!pendingRevoke} onOpenChange={(open) => { if (!open) setPendingRevoke(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.revokeBindingTitle}</DialogTitle>
            <DialogDescription>{copy.revokeBindingDescription(channelName)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button autoFocus variant="outline" onClick={() => setPendingRevoke(null)}>{copy.dialogCancel}</Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (!pendingRevoke) return;
                onRevokeRoute(pendingRevoke.id);
                setPendingRevoke(null);
              }}
            >
              {copy.revokeBinding}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ChannelSection>
  );
}
