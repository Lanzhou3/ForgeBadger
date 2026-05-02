"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, RotateCcw, Search, Square, TerminalSquare, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { deleteSession, listSessions, startSession, stopSession } from "@/lib/api";
import { useLanguage } from "@/hooks/use-language";

export default function SessionsPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { data, isLoading } = useQuery({
    queryKey: ["sessions"],
    queryFn: listSessions,
  });

  const refreshSessions = () => {
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
  };

  const startMutation = useMutation({
    mutationFn: startSession,
    onSuccess: refreshSessions,
  });
  const stopMutation = useMutation({
    mutationFn: stopSession,
    onSuccess: refreshSessions,
  });
  const deleteMutation = useMutation({
    mutationFn: deleteSession,
    onSuccess: refreshSessions,
  });

  const sessions = data?.sessions ?? [];
  const filteredSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return sessions.filter((session) => {
      const matchesStatus = statusFilter === "all" || session.status === statusFilter;
      if (!matchesStatus) {
        return false;
      }
      if (normalizedQuery.length === 0) {
        return true;
      }
      return [
        session.name,
        session.tmuxName,
        session.id,
        session.projectName,
        session.projectId,
        session.aiTool,
        session.status,
      ].some((value) => value?.toLowerCase().includes(normalizedQuery));
    });
  }, [query, sessions, statusFilter]);

  const groupedSessions = useMemo(() => {
    const groups = new Map<string, typeof filteredSessions>();
    for (const session of filteredSessions) {
      const groupName = session.projectName ?? session.projectId ?? t("sessions.unknownProject");
      groups.set(groupName, [...(groups.get(groupName) ?? []), session]);
    }
    return Array.from(groups.entries()).map(([projectName, projectSessions]) => ({
      projectName,
      sessions: projectSessions,
    }));
  }, [filteredSessions, t]);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("sessions.title")}</h1>
        <p className="mt-1 text-muted-foreground">
          {t("sessions.subtitle")}
        </p>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("sessions.loading")}
          </CardContent>
        </Card>
      ) : sessions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <TerminalSquare className="size-10 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-medium">{t("sessions.emptyTitle")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("sessions.emptyDescription")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_180px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("sessions.searchPlaceholder")}
                  className="pl-9"
                />
              </div>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                aria-label={t("sessions.statusFilter")}
              >
                <option value="all">{t("sessions.statusAll")}</option>
                <option value="running">{t("sessions.running")}</option>
                <option value="stopped">{t("sessions.stopped")}</option>
                <option value="error">{t("sessions.error")}</option>
              </select>
            </CardContent>
          </Card>

          {filteredSessions.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                <TerminalSquare className="size-8 text-muted-foreground" />
                <h3 className="mt-3 text-base font-medium">{t("sessions.noMatchesTitle")}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("sessions.noMatchesDescription")}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                {groupedSessions.map((group) => (
                  <div key={group.projectName} className="border-b last:border-b-0">
                    <div className="flex items-center justify-between gap-3 bg-muted/30 px-4 py-3">
                      <div>
                        <h2 className="text-sm font-medium">{group.projectName}</h2>
                        <p className="text-xs text-muted-foreground">{t("sessions.groupedByProject")}</p>
                      </div>
                      <Badge variant="secondary">{group.sessions.length}</Badge>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("common.name")}</TableHead>
                          <TableHead>{t("common.status")}</TableHead>
                          <TableHead>{t("common.aiTool")}</TableHead>
                          <TableHead className="w-[280px] text-right">{t("common.actions")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.sessions.map((session) => {
                          const isRunning = session.status === "running";
                          const canStart = !isRunning;
                          return (
                            <TableRow key={session.id}>
                              <TableCell className="font-medium">
                                {session.name || session.tmuxName || session.id}
                              </TableCell>
                              <TableCell>
                                <SessionStatusBadge status={session.status} />
                              </TableCell>
                              <TableCell>{session.aiTool ?? "—"}</TableCell>
                              <TableCell>
                                <div className="flex justify-end gap-1">
                                  {isRunning ? (
                                    <Button asChild variant="ghost" size="sm">
                                      <Link href={`/sessions/${session.id}`}>
                                        <Play className="mr-2 size-3" />
                                        {t("common.connect")}
                                      </Link>
                                    </Button>
                                  ) : (
                                    <Button variant="ghost" size="sm" disabled>
                                      <Play className="mr-2 size-3" />
                                      {t("common.connect")}
                                    </Button>
                                  )}
                                  {canStart ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => startMutation.mutate(session.id)}
                                      disabled={startMutation.isPending}
                                    >
                                      <RotateCcw className="mr-2 size-3" />
                                      {t("common.start")}
                                    </Button>
                                  ) : (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => stopMutation.mutate(session.id)}
                                      disabled={stopMutation.isPending}
                                    >
                                      <Square className="mr-2 size-3" />
                                      {t("common.stop")}
                                    </Button>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive"
                                    onClick={() => deleteMutation.mutate(session.id)}
                                    disabled={deleteMutation.isPending}
                                    aria-label={`${t("sessions.deleteLabel")} ${session.name || session.id}`}
                                  >
                                    <Trash2 className="size-3" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function SessionStatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  if (status === "running") {
    return (
      <Badge variant="default" className="bg-green-600 hover:bg-green-600">
        {t("sessions.running")}
      </Badge>
    );
  }
  if (status === "error") {
    return <Badge variant="destructive">{t("sessions.error")}</Badge>;
  }
  return <Badge variant="secondary">{t("sessions.stopped")}</Badge>;
}
