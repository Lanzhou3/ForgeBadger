import { AlertTriangle, CheckCircle2, Clock3, ShieldCheck, Workflow, type LucideIcon } from "lucide-react";

import type { PortfolioDossier, PortfolioWorkspaceProjection } from "@/lib/portfolio-api";
import { formatPortfolioTime, portfolioActionClassLabel, portfolioAuthorizationTierLabel, portfolioReasonClassLabel, portfolioStatusLabel, usePortfolioCopy } from "@/lib/portfolio-i18n";

interface PortfolioDossierDetailProps {
  dossier: PortfolioDossier;
  projection: PortfolioWorkspaceProjection;
}

export function PortfolioDossierDetail({ dossier, projection }: PortfolioDossierDetailProps) {
  const { copy, language } = usePortfolioCopy();
  const dossierName = dossier.projectName || dossier.projectId || copy.none;
  const workItems = projection.workItems.filter((item) => item.projectId === dossier.projectId);
  const risks = projection.risks.filter((item) => item.projectId === dossier.projectId);
  const authorizations = projection.authorizations.filter((item) => item.projectId === dossier.projectId);
  const wakeups = projection.wakeups.filter((item) => item.projectId === dossier.projectId);
  const attempts = projection.attempts.filter((item) => item.projectId === dossier.projectId);

  return (
    <section className="space-y-4" aria-label={`${dossierName} ${copy.projectDossier}`}>
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border/70 px-4 py-3">
          <h2 className="text-sm font-semibold">{copy.projectDossier} · {dossierName}</h2>
        </div>
        <dl className="grid gap-4 px-4 py-4 text-sm md:grid-cols-2">
          <Detail term={copy.objective} value={dossier.objective} />
          <Detail term={copy.intendedOutcome} value={dossier.intendedOutcome} />
          <Detail term={copy.scope} value={dossier.scope} />
          <Detail term={copy.observedState} value={dossier.observedState?.summary} />
        </dl>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <PortfolioRecordList title={copy.workItems} icon={CheckCircle2} records={workItems.map((item) => ({ id: item.id, label: item.title, state: item.state, detail: formatPortfolioTime(item.updatedAt, language, copy.timeUnavailable) }))} empty={copy.noWorkItems} />
        <PortfolioRecordList title={copy.attempts} icon={Workflow} records={attempts.map((item) => ({ id: item.id, label: `${copy.attempts} ${item.attemptNumber}`, statusLabel: portfolioStatusLabel(item.state, copy), detail: copy.statusSummary }))} empty={copy.noAttempts} />
        <PortfolioRecordList title={copy.evidence} icon={CheckCircle2} records={projection.evidence.filter((item) => item.projectId === dossier.projectId).map((item) => ({ id: item.id, label: item.redactedSummary, state: item.freshness, detail: formatPortfolioTime(item.observedAt, language, copy.timeUnavailable) }))} empty={copy.noEvidence} />
        <PortfolioRecordList title={copy.riskSignals} icon={AlertTriangle} records={risks.map((item) => ({ id: item.id, label: item.summary, state: item.severity, detail: portfolioStatusLabel(item.state, copy) }))} empty={copy.noRisks} />
        <PortfolioRecordList title={copy.authorization} icon={ShieldCheck} records={authorizations.map((item) => ({ id: item.id, label: portfolioActionClassLabel(item.actionClass, copy), state: item.state, detail: portfolioAuthorizationTierLabel(item.authorizationTier, copy) }))} empty={copy.noAuthorization} />
        <PortfolioRecordList title={copy.wakeups} icon={Clock3} records={wakeups.map((item) => ({ id: item.id, label: portfolioReasonClassLabel(item.reasonClass, copy), state: item.state, detail: formatAttemptBudget(item.attemptCount, item.maxAttempts, copy) }))} empty={copy.noWakeups} />
        <PortfolioRecordList title={copy.heartbeat} icon={Clock3} records={heartbeatRecords(projection, copy, language)} empty={copy.heartbeatDisabled} />
      </div>
    </section>
  );
}

function Detail({ term, value }: { term: string; value?: string | null }) {
  const { copy } = usePortfolioCopy();
  return <div><dt className="text-xs font-medium text-muted-foreground">{term}</dt><dd className="mt-1 leading-5">{value || copy.none}</dd></div>;
}

interface PortfolioRecordListProps {
  title: string;
  icon: LucideIcon;
  records: Array<{ id: string; label: string; detail: string; state?: string; statusLabel?: string }>;
  empty: string;
}

function PortfolioRecordList({ title, icon: Icon, records, empty }: PortfolioRecordListProps) {
  const { copy } = usePortfolioCopy();
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2.5"><Icon className="size-3.5 text-muted-foreground" /><h3 className="text-sm font-semibold">{title}</h3></div>
      {records.length === 0 ? <p className="px-3 py-4 text-xs text-muted-foreground">{empty}</p> : <div className="divide-y divide-border/70">{records.map((record) => <div key={record.id} className="px-3 py-2.5"><div className="truncate text-xs font-medium">{record.label || copy.none}</div><div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground"><span className="truncate">{record.detail || copy.none}</span><span className="shrink-0 text-brand">{record.statusLabel ?? portfolioStatusLabel(record.state, copy)}</span></div></div>)}</div>}
    </div>
  );
}

function heartbeatRecords(
  projection: PortfolioWorkspaceProjection,
  copy: ReturnType<typeof usePortfolioCopy>["copy"],
  language: ReturnType<typeof usePortfolioCopy>["language"]
) {
  const heartbeat = projection.heartbeat;
  if (!heartbeat) return [];
  return [{ id: "heartbeat", label: heartbeat.enabled ? copy.scheduledObservation : copy.noRecurringObservation, statusLabel: heartbeat.enabled ? portfolioStatusLabel(heartbeat.state, copy) : copy.disabled, detail: heartbeat.lastObservedAt ? formatPortfolioTime(heartbeat.lastObservedAt, language, copy.timeUnavailable) : copy.notObserved }];
}

function formatAttemptBudget(attemptCount: number, maxAttempts: number, copy: ReturnType<typeof usePortfolioCopy>["copy"]): string {
  return `${attemptCount}/${maxAttempts} ${copy.claims}`;
}
