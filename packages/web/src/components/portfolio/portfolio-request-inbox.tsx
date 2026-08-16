"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Inbox, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { usePortfolioOwnerDecision, usePortfolioRequestSubmission } from "@/hooks/use-portfolio";
import type { CreatePortfolioRequestInput, PortfolioDossier, PortfolioRequest } from "@/lib/portfolio-api";
import { formatPortfolioTime, portfolioNeedsOwnerDecision, portfolioStatusLabel, usePortfolioCopy } from "@/lib/portfolio-i18n";

interface PortfolioRequestInboxProps {
  dossiers: PortfolioDossier[];
  initialProjectId?: string | null;
  requests: PortfolioRequest[];
}

/** Captures a bounded requirement without exposing terminal or dispatch controls. */
export function PortfolioRequestInbox({ dossiers, initialProjectId, requests }: PortfolioRequestInboxProps) {
  const { copy, language } = usePortfolioCopy();
  const [requestText, setRequestText] = useState("");
  const [lastSubmission, setLastSubmission] = useState<CreatePortfolioRequestInput | null>(null);
  const requestMutation = usePortfolioRequestSubmission();
  const ownerDecisionMutation = usePortfolioOwnerDecision();
  const contextualDossier = useMemo(
    () => dossiers.find((dossier) => dossier.projectId === initialProjectId) ?? null,
    [dossiers, initialProjectId]
  );

  function submitRequest() {
    const originalText = requestText.trim();
    if (!originalText) return;
    const input: CreatePortfolioRequestInput = {
      originalText,
      ...(initialProjectId ? { projectId: initialProjectId } : {}),
    };
    setLastSubmission(input);
    requestMutation.mutate(input, {
      onSuccess: () => {
        setRequestText("");
        setLastSubmission(null);
      },
    });
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card" aria-labelledby="portfolio-request-inbox-title">
      <div className="border-b border-border/70 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
            <Inbox className="size-4" aria-hidden="true" />
          </div>
          <div>
            <h2 id="portfolio-request-inbox-title" className="text-sm font-semibold">{copy.requestInbox}</h2>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {copy.requestInboxDescription}
            </p>
          </div>
        </div>
      </div>
      <div className="space-y-3 p-4">
        {contextualDossier ? (
          <p className="rounded-md border border-brand/20 bg-brand/5 px-3 py-2 text-xs text-muted-foreground">
            {copy.projectContext}: <span className="font-medium text-foreground">{contextualDossier.projectName}</span>
          </p>
        ) : initialProjectId ? (
          <p className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {copy.projectAttached}
          </p>
        ) : null}
        <label className="block space-y-2" htmlFor="portfolio-request-text">
          <span className="text-sm font-medium">{copy.requirement}</span>
          <Textarea
            id="portfolio-request-text"
            value={requestText}
            onChange={(event) => setRequestText(event.target.value)}
            maxLength={32_768}
            placeholder={copy.requirementPlaceholder}
            disabled={requestMutation.isPending}
          />
        </label>
        {requestMutation.error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
            <p>{copy.errorDescription}</p>
            {lastSubmission ? (
              <Button type="button" size="xs" variant="outline" className="mt-2" onClick={() => requestMutation.retry(lastSubmission)}>
                {copy.retry}
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{copy.retryNote}</p>
          <Button type="button" size="sm" disabled={!requestText.trim() || requestMutation.isPending} onClick={submitRequest}>
            <Send className="size-4" aria-hidden="true" />
            {requestMutation.isPending ? copy.recording : copy.recordRequest}
          </Button>
        </div>
      </div>
      <div className="border-t border-border/70">
        {requests.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">{copy.noRequests}</div>
        ) : (
          <div className="divide-y divide-border/70">
            {requests.map((request) => (
              <RequestRow
                key={request.id}
                request={request}
                dossier={dossiers.find((dossier) => dossier.projectId === request.projectId) ?? null}
                onConfirmOwnerDecision={() => ownerDecisionMutation.mutate({ requestId: request.id, projectId: request.projectId as string })}
                isConfirming={ownerDecisionMutation.isPending}
                ownerDecisionError={ownerDecisionMutation.error ? copy.errorDescription : null}
                copy={copy}
                language={language}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

interface RequestRowProps {
  request: PortfolioRequest;
  dossier: PortfolioDossier | null;
  onConfirmOwnerDecision: () => void;
  isConfirming: boolean;
  ownerDecisionError: string | null;
  copy: ReturnType<typeof usePortfolioCopy>["copy"];
  language: ReturnType<typeof usePortfolioCopy>["language"];
}

function RequestRow({ request, dossier, onConfirmOwnerDecision, isConfirming, ownerDecisionError, copy, language }: RequestRowProps) {
  const needsOwnerDecision = portfolioNeedsOwnerDecision(request.status);
  const canConfirmOwnerDecision = needsOwnerDecision && Boolean(request.projectId && dossier);

  return (
    <article className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm">{request.originalText || copy.none}</p>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{portfolioStatusLabel(request.status, copy)}</span>
      </div>
      <p className="text-xs text-muted-foreground">{copy.received} {formatPortfolioTime(request.receivedAt, language, copy.timeUnavailable)}</p>
      {canConfirmOwnerDecision ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs">
          <AlertTriangle className="size-3.5 shrink-0 text-amber-500" aria-hidden="true" />
          <span className="min-w-0 flex-1">{copy.ownerDecision.replace("{project}", dossier?.projectName ?? copy.none)}</span>
          <Button type="button" size="xs" onClick={onConfirmOwnerDecision} disabled={isConfirming}>
            <CheckCircle2 className="size-3" aria-hidden="true" />
            {isConfirming ? copy.confirming : copy.confirmAssignment}
          </Button>
        </div>
      ) : null}
      {needsOwnerDecision && !canConfirmOwnerDecision ? (
        <p className="text-xs text-amber-500">{copy.ownerWaiting}</p>
      ) : null}
      {needsOwnerDecision && ownerDecisionError ? <p className="text-xs text-destructive" role="alert">{ownerDecisionError}</p> : null}
    </article>
  );
}
