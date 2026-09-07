"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Gauge } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  testModelProviderEndpoint,
  type ModelProviderEndpointHealth,
  type ProviderProfile,
} from "@/lib/api";

import { formatCheckedAt, type Translate } from "./shared";

interface DiagnosticsTabProps {
  provider: ProviderProfile;
  t: Translate;
}

/** Endpoint latency diagnostics. The result stays rendered until the provider changes. */
export function DiagnosticsTab({ provider, t }: DiagnosticsTabProps) {
  const [endpointHealth, setEndpointHealth] = useState<ModelProviderEndpointHealth | null>(null);

  useEffect(() => {
    setEndpointHealth(null);
  }, [provider.id]);

  const endpointMutation = useMutation({
    mutationFn: () => testModelProviderEndpoint(provider.id, { timeoutMs: 5000 }),
    onSuccess: (result) => setEndpointHealth(result.health),
  });

  const endpointError =
    endpointMutation.error instanceof Error ? endpointMutation.error.message : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
            <Gauge className="size-4" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base">{t("models.endpointTest")}</CardTitle>
            <CardDescription className="mt-1">{t("models.endpointTestDescription")}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={endpointMutation.isPending}
          onClick={() => endpointMutation.mutate()}
        >
          <Gauge className={`size-4 ${endpointMutation.isPending ? "animate-pulse" : ""}`} />
          {endpointMutation.isPending ? t("models.checkingEndpoint") : t("models.checkEndpoint")}
        </Button>

        {endpointError ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {endpointError}
          </p>
        ) : null}
        {endpointHealth ? (
          <div
            data-testid="endpoint-health-row"
            className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs"
          >
            <Badge variant={endpointHealth.healthy ? "default" : "outline"}>
              {endpointHealth.healthy ? t("models.endpointHealthy") : t("models.endpointFailed")}
            </Badge>
            <span className="text-muted-foreground">
              {endpointHealth.latencyMs} ms
              {endpointHealth.statusCode ? ` · HTTP ${endpointHealth.statusCode}` : ""}
              {" · "}
              {formatCheckedAt(endpointHealth.checkedAt)}
            </span>
            {endpointHealth.error ? (
              <span className="text-destructive">{endpointHealth.error}</span>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
