"use client";

import { useQuery } from "@tanstack/react-query";
import { KeyRound, ShieldCheck } from "lucide-react";

import { SettingsCardHeader } from "@/components/settings/ui";
import { useAdminCopy } from "@/components/settings/admin-copy";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useLanguage } from "@/hooks/use-language";
import { getDependencies } from "@/lib/api";

/** Read-only security baseline card. The terminal persistence label reuses
 * the shared dependencies query, so it hits the TanStack Query cache when the
 * adapter section has already fetched it. */
export function SecurityBaselineSettings() {
  const { t } = useLanguage();
  const adminCopy = useAdminCopy();
  const { data: dependenciesData } = useQuery({
    queryKey: ["dependencies"],
    queryFn: getDependencies,
  });
  const terminalPersistenceLabel =
    dependenciesData?.terminalRuntime?.persistence ?? t("settings.notDetected");

  return (
    <Card className="forgebadger-animate-in" style={{ animationDelay: "40ms" }}>
      <SettingsCardHeader
        icon={<ShieldCheck className="size-4" />}
        title={t("settings.securityBaseline")}
        description={t("settings.securityDescription")}
      />
      <CardContent className="space-y-3">
        <div className="divide-y divide-border/70 overflow-hidden rounded-md border border-border/70">
          {/* JWT auth and tenant isolation are architectural guarantees, not
              runtime detections — label them as such instead of a bare
              "enabled" that implies a live probe. */}
          <SecurityItem label={t("settings.jwtAuth")} value={adminCopy.securityBaselineGuaranteed} />
          <SecurityItem label={t("settings.tenantIsolation")} value={adminCopy.securityBaselineGuaranteed} />
          <SecurityItem label={t("settings.apiKeyEncryption")} value="AES-256-GCM" />
          <SecurityItem
            label={t("settings.terminalPersistence")}
            value={terminalPersistenceLabel}
          />
        </div>
        <div className="flex items-start gap-2.5 rounded-md border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
          <KeyRound className="mt-0.5 size-3.5 shrink-0" />
          <span>{adminCopy.securityBaselineGuaranteedHint}</span>
        </div>
        <div className="flex items-start gap-2.5 rounded-md border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
          <KeyRound className="mt-0.5 size-3.5 shrink-0" />
          <span>{t("settings.secretsNotice")}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function SecurityItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Badge variant="secondary">{value}</Badge>
    </div>
  );
}
