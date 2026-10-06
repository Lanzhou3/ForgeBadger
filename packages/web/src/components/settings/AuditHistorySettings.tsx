"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ScrollText } from "lucide-react";

import { SettingsCardHeader } from "@/components/settings/ui";
import { auditActionLabel, useAdminCopy } from "@/components/settings/admin-copy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLanguage, useUiLocale } from "@/hooks/use-language";
import { listAuditLogs } from "@/lib/api";

/** Recent audit history card (template restores, config syncs, ...). */
export function AuditHistorySettings() {
  const { t } = useLanguage();
  const locale = useUiLocale();
  const adminCopy = useAdminCopy();
  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ["audit-logs", "settings"],
    queryFn: () => listAuditLogs({ limit: 8 }),
  });

  return (
    <Card className="forgebadger-animate-in" style={{ animationDelay: "80ms" }}>
      <SettingsCardHeader
        icon={<ScrollText className="size-4" />}
        title={t("settings.auditHistory")}
        description={t("settings.auditDescription")}
        action={
          <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
            <Link href="/history">
              {adminCopy.auditViewAll}
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        }
      />
      <CardContent>
        {auditLoading ? (
          <p className="text-xs text-muted-foreground">{t("settings.auditLoading")}</p>
        ) : (auditData?.auditLogs.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center gap-2.5 py-6 text-center">
            <div className="flex size-9 items-center justify-center rounded-md bg-brand/10 text-brand">
              <ScrollText className="size-4" />
            </div>
            <p className="text-xs text-muted-foreground">{t("settings.auditEmpty")}</p>
          </div>
        ) : (
          <div className="divide-y divide-border/70 overflow-hidden rounded-md border border-border/70">
            {auditData?.auditLogs.map((entry) => (
              <div key={entry.id} className="px-3 py-2.5 transition-colors hover:bg-muted/40">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium">
                    {auditActionLabel(adminCopy, entry.action)}
                  </span>
                  <Badge variant="outline">{entry.resourceType}</Badge>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString(locale)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
