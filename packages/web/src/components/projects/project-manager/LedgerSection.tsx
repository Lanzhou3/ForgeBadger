"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, History, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  ProjectManagerLedgerEvent,
  ProjectManagerLedgerTrace,
  ProjectManagerWorkItem,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { LEDGER_FILTER_OPTIONS, type LedgerFilter, type Translate } from "./types";
import {
  eventLabel,
  formatTimestamp,
  ledgerEventBadgeVariant,
  ledgerEventNote,
  ledgerTraceMarkers,
  ledgerWorkItemTitle,
  statusBadgeVariant,
  statusLabel,
} from "./utils";
import { EmptyState, LedgerDatum } from "./shared";

export function ProjectManagerLedgerSection({
  error,
  events,
  filter,
  hasLoadedEvents,
  isFetching,
  onFilterChange,
  onLoadMore,
  onRefresh,
  refreshing,
  t,
  totalCount,
  workItems,
}: {
  error: unknown;
  events: ProjectManagerLedgerEvent[];
  filter: LedgerFilter;
  hasLoadedEvents: boolean;
  isFetching: boolean;
  onFilterChange: (filter: LedgerFilter) => void;
  onLoadMore: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  t: Translate;
  totalCount: number;
  workItems: ProjectManagerWorkItem[];
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Card data-testid="project-manager-ledger">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <History className="size-4 text-brand" />
          {t("projects.projectManagerLedger")}
          <span className="rounded border border-border/70 bg-muted/20 px-1.5 py-0.5 font-mono text-xs text-muted-foreground tabular-nums">
            {totalCount}
          </span>
        </CardTitle>
        <Button
          size="xs"
          variant="ghost"
          aria-label={t("projects.projectManagerLedgerToggle")}
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
        >
          <ChevronDown className={cn("size-4 transition-transform", isOpen && "rotate-180")} />
        </Button>
      </CardHeader>
      <div className="of-collapse-grid" data-open={isOpen}>
        <div>
          <CardContent className="space-y-3 pt-0">
            <div className="flex flex-wrap gap-2 border-t border-border/70 pt-3">
              {LEDGER_FILTER_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  size="sm"
                  variant={filter === option.value ? "default" : "outline"}
                  className={filter === option.value ? "bg-brand text-brand-foreground hover:bg-brand/90" : undefined}
                  onClick={() => onFilterChange(option.value)}
                >
                  {t(option.labelKey)}
                </Button>
              ))}
            </div>
            {error ? (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-center gap-2 text-sm text-destructive">
                    <AlertTriangle className="size-4" />
                    {t("projects.projectManagerLedgerLoadFailed")}
                  </p>
                  <Button size="sm" variant="outline" onClick={onRefresh} disabled={refreshing}>
                    <RefreshCw className={cn("mr-2 size-4", refreshing && "animate-spin")} />
                    {t("projects.projectManagerLedgerRefresh")}
                  </Button>
                </div>
              </div>
            ) : isFetching && !hasLoadedEvents ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                {t("projects.projectManagerLoading")}
              </div>
            ) : !hasLoadedEvents ? (
              <EmptyState
                title={t("projects.projectManagerNoLedgerTitle")}
                body={t("projects.projectManagerNoLedgerBody")}
                icon={History}
              />
            ) : events.length === 0 ? (
              <EmptyState
                title={t("projects.projectManagerLedgerFilteredEmptyTitle")}
                body={t("projects.projectManagerLedgerFilteredEmptyBody")}
                icon={History}
              />
            ) : (
              <div className="space-y-3">
                {events.map((event) => (
                  <ProjectManagerLedgerRow
                    key={event.id}
                    event={event}
                    t={t}
                    workItemTitle={ledgerWorkItemTitle(event, workItems)}
                  />
                ))}
              </div>
            )}
            {!error && (
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={onLoadMore} disabled={isFetching}>
                  {t("projects.projectManagerLoadMoreLedger")}
                </Button>
              </div>
            )}
          </CardContent>
        </div>
      </div>
    </Card>
  );
}

function ProjectManagerLedgerRow({
  event,
  t,
  workItemTitle,
}: {
  event: ProjectManagerLedgerEvent;
  t: Translate;
  workItemTitle: string;
}) {
  const note = ledgerEventNote(event.eventType, t);

  return (
    <div className="rounded-md border border-border/70 bg-muted/10 px-3 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={ledgerEventBadgeVariant(event.eventType)}>
              {eventLabel(event.eventType, t)}
            </Badge>
            {event.status ? (
              <Badge variant={statusBadgeVariant(event.status)}>
                {statusLabel(event.status, t)}
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">-</span>
            )}
          </div>
          <p className="break-words text-sm font-medium">{workItemTitle}</p>
          {note && <p className="text-xs leading-5 text-muted-foreground">{note}</p>}
        </div>
        <div className="text-xs text-muted-foreground">{formatTimestamp(event.createdAt)}</div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <LedgerDatum label={t("projects.projectManagerEvidenceRefs")} value={event.evidenceRefCount} />
        <LedgerDatum label={t("projects.projectManagerFeishuRefs")} value={event.feishuRefCount} />
      </div>
      {event.trace && <LedgerTraceGrid trace={event.trace} t={t} />}
    </div>
  );
}

function LedgerTraceGrid({ trace, t }: { trace: ProjectManagerLedgerTrace; t: Translate }) {
  const markers = ledgerTraceMarkers(trace);
  if (markers.length === 0) return null;

  return (
    <div className="mt-3 rounded-md border border-border/70 bg-background/40 p-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">
        {t("projects.projectManagerLedger")}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {markers.map((marker) => (
          <LedgerDatum
            key={`${marker.labelKey}-${marker.value}`}
            label={t(marker.labelKey)}
            value={marker.value}
          />
        ))}
      </div>
    </div>
  );
}
