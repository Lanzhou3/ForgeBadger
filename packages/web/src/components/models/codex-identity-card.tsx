import { ExternalLink, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CodexSubscriptionStatus } from "@/lib/api";

import { EmptyLine, SummaryCell, type Translate } from "./shared";

export function CodexIdentityCard({
  status,
  isLoading,
  t,
}: {
  status: CodexSubscriptionStatus | undefined;
  isLoading: boolean;
  t: Translate;
}) {
  return (
    <Card className="forgebadger-animate-in" style={{ animationDelay: "80ms" }}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
            <ShieldCheck className="size-4" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base">{t("models.codexSubscription")}</CardTitle>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("models.codexSubscriptionDescription")}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isLoading ? (
          <EmptyLine text={t("common.loading")} />
        ) : status ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant={status.providerApplyEnabled ? "outline" : "secondary"}>
                {status.providerApplyEnabled ? t("models.providerApplyEnabled") : t("models.providerApplyDisabled")}
              </Badge>
              <Badge variant="outline">{status.connectionState}</Badge>
              <Badge variant="outline">{status.identitySource}</Badge>
            </div>
            <div className="grid gap-2">
              <SummaryCell label={t("models.codexAccountLabel")} value={status.accountLabel ?? t("models.codexNoAccount")} />
              <SummaryCell label={t("models.codexSdkPackage")} value={`${status.sdk.packageName} / ${status.sdk.installed ? t("models.sdkInstalled") : t("models.sdkMissing")}`} />
            </div>
            <a className="inline-flex items-center gap-1 text-xs text-brand hover:underline" href={status.sdk.docsUrl} target="_blank" rel="noreferrer">
              {t("models.codexOfficialDocs")}
              <ExternalLink className="size-3" />
            </a>
          </>
        ) : (
          <EmptyLine text={t("models.codexStatusUnavailable")} />
        )}
      </CardContent>
    </Card>
  );
}
