"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Clock3, DollarSign, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  getUsageSummary,
  listModels,
  listProjects,
  listUsageRates,
  setUsageRate,
  type Model
} from "@/lib/api";
import { formatDurationMs, formatEstimatedUsd } from "@/lib/usage-format";
import { syncUsageRateValues } from "@/lib/usage-rates";
import { useLanguage } from "@/hooks/use-language";

interface UsageRow {
  key: string;
  sessions: number;
  durationMs: number;
  estimatedCostUsd: number;
}

export default function UsagePage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [rateValues, setRateValues] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");

  const { data: usageData, isLoading } = useQuery({
    queryKey: ["usage-summary"],
    queryFn: getUsageSummary
  });
  const { data: ratesData } = useQuery({
    queryKey: ["usage-rates"],
    queryFn: listUsageRates
  });
  const { data: modelsData } = useQuery({
    queryKey: ["models"],
    queryFn: listModels
  });
  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects
  });

  const models = modelsData?.models ?? [];
  const rates = ratesData?.rates ?? [];
  const summary = usageData?.summary;
  const projectById = useMemo(
    () => new Map((projectsData?.projects ?? []).map((project) => [project.id, project.name])),
    [projectsData?.projects]
  );
  const modelById = useMemo(
    () => new Map(models.map((model) => [model.id, model.name])),
    [models]
  );
  const rateByModel = useMemo(
    () => new Map(rates.map((rate) => [rate.modelId, rate.hourlyRateUsd])),
    [rates]
  );

  useEffect(() => {
    setRateValues((current) => syncUsageRateValues(current, models, rateByModel));
  }, [models, rateByModel]);

  const rateMutation = useMutation({
    mutationFn: ({ modelId, hourlyRateUsd }: { modelId: string; hourlyRateUsd: number }) =>
      setUsageRate(modelId, hourlyRateUsd),
    onSuccess: () => {
      setNotice(t("usage.rateUpdated"));
      queryClient.invalidateQueries({ queryKey: ["usage-rates"] });
      queryClient.invalidateQueries({ queryKey: ["usage-summary"] });
    },
    onError: (error) => {
      setNotice(error instanceof Error ? error.message : t("usage.failedSaveRate"));
    }
  });

  const saveRate = (modelId: string) => {
    const hourlyRateUsd = Number.parseFloat(rateValues[modelId] ?? "0");
    if (!Number.isFinite(hourlyRateUsd) || hourlyRateUsd < 0) {
      setNotice(t("usage.failedSaveRate"));
      return;
    }
    rateMutation.mutate({ modelId, hourlyRateUsd });
  };

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("usage.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {t("usage.subtitle")}
        </p>
      </div>

      <Card className="border-amber-500/40 bg-amber-500/10">
        <CardContent className="py-4 text-sm text-muted-foreground">
          {t("usage.estimatedCostNotice")}
        </CardContent>
      </Card>

      {isLoading || !summary ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("usage.loading")}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <MetricCard
              icon={BarChart3}
              label={t("usage.totalSessions")}
              value={String(summary.totalSessions)}
            />
            <MetricCard
              icon={Clock3}
              label={t("usage.totalDuration")}
              value={formatDurationMs(summary.totalDurationMs)}
            />
            <MetricCard
              icon={DollarSign}
              label={t("usage.estimatedCost")}
              value={formatEstimatedUsd(summary.estimatedCostUsd)}
            />
          </div>

          {summary.totalSessions === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <BarChart3 className="size-10 text-muted-foreground" />
                <h2 className="mt-4 text-lg font-medium">{t("usage.emptyTitle")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("usage.emptyDescription")}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 xl:grid-cols-3">
              <UsageTable
                title={t("usage.byAdapter")}
                rows={summary.byAdapter}
                labelFor={(row) => row.key}
              />
              <UsageTable
                title={t("usage.byProject")}
                rows={summary.byProject}
                labelFor={(row) => projectById.get(row.key) ?? row.key}
              />
              <UsageTable
                title={t("usage.byModel")}
                rows={summary.byModel}
                labelFor={(row) =>
                  modelById.get(row.key) ??
                  (row.key === "unassigned" ? t("usage.unassigned") : row.key)
                }
              />
            </div>
          )}
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("usage.rateSettings")}</CardTitle>
          <CardDescription>{t("usage.rateDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
          {models.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("models.emptyDescription")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("usage.byModel")}</TableHead>
                  <TableHead>{t("usage.hourlyRateUsd")}</TableHead>
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.map((model) => (
                  <ModelRateRow
                    key={model.id}
                    model={model}
                    value={rateValues[model.id] ?? "0"}
                    saving={rateMutation.isPending && rateMutation.variables?.modelId === model.id}
                    onChange={(value) =>
                      setRateValues((current) => ({ ...current, [model.id]: value }))
                    }
                    onSave={() => saveRate(model.id)}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
        </div>
        <Icon className="size-5 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

function UsageTable({
  title,
  rows,
  labelFor
}: {
  title: string;
  rows: UsageRow[];
  labelFor: (row: UsageRow) => string;
}) {
  const { t } = useLanguage();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("usage.group")}</TableHead>
            <TableHead>{t("usage.sessions")}</TableHead>
            <TableHead>{t("usage.duration")}</TableHead>
            <TableHead className="text-right">{t("usage.cost")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="max-w-[180px] truncate font-medium">{labelFor(row)}</TableCell>
              <TableCell>{row.sessions}</TableCell>
              <TableCell>{formatDurationMs(row.durationMs)}</TableCell>
              <TableCell className="text-right">{formatEstimatedUsd(row.estimatedCostUsd)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function ModelRateRow({
  model,
  value,
  saving,
  onChange,
  onSave
}: {
  model: Model;
  value: string;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const { t } = useLanguage();

  return (
    <TableRow>
      <TableCell>
        <div className="space-y-1">
          <div className="font-medium">{model.name}</div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{model.provider}</Badge>
            <span className="font-mono text-xs text-muted-foreground">{model.modelId}</span>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Input
          value={value}
          type="number"
          min="0"
          step="0.01"
          onChange={(event) => onChange(event.target.value)}
          aria-label={`${model.name} ${t("usage.hourlyRateUsd")}`}
        />
      </TableCell>
      <TableCell className="text-right">
        <Button size="sm" onClick={onSave} disabled={saving}>
          {saving ? t("usage.savingRate") : t("usage.saveRate")}
        </Button>
      </TableCell>
    </TableRow>
  );
}
