"use client";

import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Square, Activity, History, Maximize2, Minimize2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { notifySessionTabsChanged, SessionTabs } from "@/components/session-tabs";
import { TerminalView } from "@/components/terminal-view";
import { connectSession, getSession, listActivities, stopSession, type SessionActivity } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { sessionToTab, upsertSessionTab } from "@/lib/session-tabs";
import { normalizeSessionStatus } from "@/lib/session-status";
import { useLanguage } from "@/hooks/use-language";

export default function TerminalPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const id = params.id as string;
  const [focusMode, setFocusMode] = useState(false);

  const authToken = getToken() ?? "";
  const attachTokenOverride = searchParams.get("attachToken");

  const { data: sessionData } = useQuery({
    queryKey: ["session", id],
    queryFn: () => getSession(id),
    enabled: !!id,
  });

  const connectMutation = useMutation({
    mutationFn: () => connectSession(id),
    onSuccess: ({ session }) => {
      queryClient.setQueryData(["session", id], { session });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const { data: activityData } = useQuery({
    queryKey: ["activities", { sessionId: id }],
    queryFn: () => listActivities({ sessionId: id, limit: 20 }),
    enabled: !!id,
  });

  const stopMutation = useMutation({
    mutationFn: () => stopSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session", id] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  useEffect(() => {
    if (!id || !authToken || attachTokenOverride || connectMutation.isPending || connectMutation.data) {
      return;
    }
    connectMutation.mutate();
  }, [attachTokenOverride, authToken, connectMutation, id]);

  const session = connectMutation.data?.session ?? sessionData?.session;
  const attachToken = attachTokenOverride ?? connectMutation.data?.session.attachToken ?? "";

  useEffect(() => {
    if (!session) {
      return;
    }
    upsertSessionTab(sessionToTab(session));
    notifySessionTabsChanged();
  }, [session]);

  const missing: string[] = [];
  if (!authToken) missing.push("login token");
  if (!attachToken) missing.push("attach token");

  if (!attachTokenOverride && (connectMutation.isIdle || connectMutation.isPending) && authToken) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sessions">
              <ArrowLeft className="size-4" />
              {t("sessions.back")}
            </Link>
          </Button>
          <span className="text-sm font-medium">Session {id}</span>
        </div>
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {t("sessions.preparing")}
        </div>
      </div>
    );
  }

  if (missing.length > 0 || connectMutation.isError) {
    const errorMessage =
      connectMutation.error instanceof Error
        ? connectMutation.error.message
        : `Missing ${missing.join(" and ")}`;
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sessions">
              <ArrowLeft className="size-4" />
              {t("sessions.back")}
            </Link>
          </Button>
          <span className="text-sm font-medium">Session {id}</span>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-md rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center">
            <h2 className="text-lg font-semibold text-destructive">
              {t("sessions.cannotOpen")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {errorMessage}. {t("sessions.returnToList")}
            </p>
            <Button asChild variant="outline" size="sm" className="mt-4">
              <Link href="/sessions">
                {t("sessions.backToSessions")}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <SessionTabs activeSessionId={id} />
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sessions">
              <ArrowLeft className="size-4" />
              {t("sessions.back")}
            </Link>
          </Button>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">
              {session?.name || session?.tmuxName || `Session ${id}`}
            </span>
            <SessionStatusBadge status={session?.status} />
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <Badge variant="outline" className="text-xs">
            {session?.aiTool ?? "Claude"}
          </Badge>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/history?sessionId=${id}`}>
              <History className="mr-2 size-3" />
              {t("nav.history")}
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFocusMode((current) => !current)}
          >
            {focusMode ? <Minimize2 className="size-3 sm:mr-2" /> : <Maximize2 className="size-3 sm:mr-2" />}
            <span className="hidden sm:inline">
              {focusMode ? t("sessions.exitFocusMode") : t("sessions.focusMode")}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => stopMutation.mutate()}
            disabled={stopMutation.isPending}
          >
            <Square className="size-3 sm:mr-2" />
            <span className="hidden sm:inline">
              {stopMutation.isPending ? t("sessions.stopping") : t("common.stop")}
            </span>
          </Button>
        </div>
      </div>

      <div className={focusMode ? "grid min-h-0 flex-1 grid-cols-1 overflow-hidden" : "grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]"}>
        <div className="h-full min-h-0 overflow-hidden">
          <TerminalView
            sessionId={id}
            authToken={authToken}
            attachToken={attachToken}
          />
        </div>
        {!focusMode && <ActivityPanel activities={activityData?.activities ?? []} />}
      </div>
    </div>
  );
}

function ActivityPanel({ activities }: { activities: SessionActivity[] }) {
  const { t } = useLanguage();

  return (
    <aside className="hidden min-h-0 overflow-auto border-t border-border bg-background/95 p-3 lg:block lg:border-l lg:border-t-0">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <Activity className="size-4 text-muted-foreground" />
        {t("sessions.activity")}
      </div>
      {activities.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("sessions.noActivity")}</p>
      ) : (
        <div className="space-y-2">
          {activities.map((activity) => (
            <div key={activity.id} className="rounded-md border border-border p-2">
              <div className="flex items-center justify-between gap-2">
                <Badge variant={activity.status === "error" ? "destructive" : "secondary"}>
                  {activity.type}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {formatActivityTime(activity.createdAt)}
                </span>
              </div>
              <p className="mt-2 break-words text-sm text-muted-foreground">{activity.message}</p>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

function formatActivityTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString();
}

function SessionStatusBadge({ status }: { status?: string }) {
  const { t } = useLanguage();
  const normalizedStatus = normalizeSessionStatus(status);
  if (normalizedStatus === "running") {
    return (
      <Badge variant="default" className="gap-1 bg-green-600 hover:bg-green-600">
        <Activity className="size-3" />
        {t("sessions.running")}
      </Badge>
    );
  }
  if (normalizedStatus === "error") {
    return <Badge variant="destructive">{t("sessions.error")}</Badge>;
  }
  return <Badge variant="secondary">{t("sessions.stopped")}</Badge>;
}
