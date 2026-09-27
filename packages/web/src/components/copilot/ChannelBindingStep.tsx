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
import type { SetupBlocker } from "./channel-setup";
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
  routeState: (route: ChannelRoute) => string;
  projectName: (projectId: string) => string;
  onRevokeRoute: (id: string) => void;
}

function routeBadgeClass(state: string): string {
  if (state === "权限有效") return "bg-emerald-500/15 text-emerald-400";
  if (state === "授权状态待核查") return "bg-amber-500/15 text-amber-400";
  if (["身份已失效", "配置已更新，需要重新绑定", "渠道已停用", "授权已失效，请撤销后重新绑定", "项目不存在", "项目 Copilot 自治未开启"].includes(state)) {
    return "bg-destructive/15 text-destructive";
  }
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
        title="3. 绑定项目与操作授权"
        description="私聊、群聊与话题各自使用独立会话。授权范围就是所选项目：项目的 Copilot 自治开关开启时渠道消息可直接执行，关闭后立即停止受理。"
      />
      <CardContent className="space-y-3">
        <div className="space-y-2 rounded-md border border-border/70 p-3">
          <p className="text-sm font-medium">管理项目 Copilot 自治开关</p>
          <CopilotManagementPanel />
        </div>
        {projectsLoading && <p role="status">正在加载项目…</p>}
        {!projectsLoading && !projectsError && !autonomyProjects.length && (
          <p className="text-sm">尚无已开启 Copilot 自治的项目，请先在上方打开项目开关。</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 text-sm">
            <span>私聊身份</span>
            <Select value={identityId} onValueChange={onIdentityChange}>
              <SelectTrigger aria-label="私聊身份" className="w-full">
                <SelectValue placeholder="选择已确认身份" />
              </SelectTrigger>
              <SelectContent>
                {identities.map((identity) => (
                  <SelectItem key={identity.id} value={identity.id}>{identity.externalUserId}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 text-sm">
            <span>项目</span>
            <Select value={projectId} onValueChange={onProjectChange}>
              <SelectTrigger aria-label="项目" className="w-full">
                <SelectValue placeholder="选择已开启自治的项目" />
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
          <Button aria-describedby="channel-activation-reason" disabled={busy || !!blocker || queriesError} onClick={onActivate}>启用{channelName}远程操作</Button>
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
        {routes.map((route) => (
          <div key={route.id} className="space-y-2 rounded-md border border-border/70 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0">{projectName(route.projectId)}</span>
              <Badge variant="secondary" className={routeBadgeClass(routeState(route))}>{routeState(route)}</Badge>
            </div>
            <p className="break-all text-xs text-muted-foreground">独立会话：{route.conversationId}</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link className="underline underline-offset-4" href={`/copilot?c=${encodeURIComponent(route.conversationId)}`}>打开会话</Link>
              <Button variant="outline" size="sm" disabled={busy || route.status !== "active"} onClick={() => onRevokeRoute(route.id)}>撤销渠道绑定</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
