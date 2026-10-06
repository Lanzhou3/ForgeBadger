"use client";

import Link from "next/link";
import { Link2 } from "lucide-react";

import { SettingsCardHeader } from "@/components/settings/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ChannelIdentity, ChannelRoute } from "@/lib/copilot-channels-api";
import { DESTRUCTIVE_ROUTE_STATES, type ChannelRouteStateKey, type SetupBlocker } from "./channel-setup";
import { CopilotManagementPanel } from "./CopilotManagementPanel";
import { useSettingsCopy } from "./settings-copy";

export interface AutonomyProjectOption {
  id: string;
  name: string;
}

interface Props {
  busy: boolean;
  queriesError: boolean;
  channelName: string;
  identities: ChannelIdentity[];
  identityId: string;
  onIdentityChange: (id: string) => void;
  autonomyProjects: AutonomyProjectOption[];
  projectId: string;
  onProjectChange: (id: string) => void;
  projectsLoading: boolean;
  projectsError: boolean;
  blocker: SetupBlocker | undefined;
  activationReason: string;
  showBlockerLink: boolean;
  onActivate: () => void;
  routes: ChannelRoute[];
  /** Semantic state key for an active route; null renders the raw route status. */
  routeState: (route: ChannelRoute) => ChannelRouteStateKey | null;
  projectName: (projectId: string) => string;
  onRevokeRoute: (id: string) => void;
}

function routeBadgeClass(state: ChannelRouteStateKey | null): string {
  if (state === "authorized") return "bg-emerald-500/15 text-emerald-400";
  if (state === "pending_review") return "bg-amber-500/15 text-amber-400";
  if (state && DESTRUCTIVE_ROUTE_STATES.includes(state)) return "bg-destructive/15 text-destructive";
  return "text-muted-foreground";
}

/** Step 3: bind a confirmed identity to an autonomy-enabled project. */
export function ChannelBindingStep({
  busy, queriesError, channelName, identities, identityId, onIdentityChange,
  autonomyProjects, projectId, onProjectChange, projectsLoading, projectsError,
  blocker, activationReason, showBlockerLink, onActivate, routes, routeState, projectName, onRevokeRoute,
}: Props) {
  const copy = useSettingsCopy();
  return (
    <Card id="channel-authorization" className="forgebadger-animate-in">
      <SettingsCardHeader
        icon={<Link2 className="size-4" />}
        title={copy.bindingTitle}
        description={copy.bindingDescription}
      />
      <CardContent className="space-y-3">
        <div className="space-y-2 rounded-md border border-border/70 p-3">
          <p className="text-sm font-medium">{copy.manageAutonomy}</p>
          <CopilotManagementPanel />
        </div>
        {projectsLoading && <p role="status">{copy.projectsLoading}</p>}
        {!projectsLoading && !projectsError && !autonomyProjects.length && (
          <p className="text-sm">{copy.noAutonomyProjects}</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 text-sm">
            <span>{copy.identityLabel}</span>
            <Select value={identityId} onValueChange={onIdentityChange}>
              <SelectTrigger aria-label={copy.identityLabel} className="w-full">
                <SelectValue placeholder={copy.identityPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {identities.map((identity) => (
                  <SelectItem key={identity.id} value={identity.id}>{identity.externalUserId}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 text-sm">
            <span>{copy.projectLabel}</span>
            <Select value={projectId} onValueChange={onProjectChange}>
              <SelectTrigger aria-label={copy.projectLabel} className="w-full">
                <SelectValue placeholder={copy.projectPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {autonomyProjects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end">
          <Button aria-describedby="channel-activation-reason" disabled={busy || !!blocker || queriesError} onClick={onActivate}>{copy.activateRemote(channelName)}</Button>
        </div>
        <p id="channel-activation-reason" data-testid="channel-activation-reason" role="status" className="text-sm text-muted-foreground">
          {activationReason}
          {blocker && showBlockerLink && (
            <a className="ml-2 underline underline-offset-4" href={`#channel-${blocker.step}`}>{blocker.action}</a>
          )}
        </p>
        {routes.length === 0 && (
          <p className="text-sm text-muted-foreground">{copy.bindingsEmpty}</p>
        )}
        {routes.map((route) => {
          const stateKey = routeState(route);
          return (
            <div key={route.id} className="space-y-2 rounded-md border border-border/70 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">{projectName(route.projectId)}</span>
                <Badge variant="secondary" className={routeBadgeClass(stateKey)}>
                  {stateKey ? copy.routeStates[stateKey] : (copy.channelStates[route.status] ?? route.status)}
                </Badge>
              </div>
              <p className="break-all text-xs text-muted-foreground">{copy.independentSession(route.conversationId)}</p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link className="underline underline-offset-4" href={`/copilot?c=${encodeURIComponent(route.conversationId)}`}>{copy.openConversation}</Link>
                <Button variant="outline" size="sm" disabled={busy || route.status !== "active"} onClick={() => onRevokeRoute(route.id)}>{copy.revokeBinding}</Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
