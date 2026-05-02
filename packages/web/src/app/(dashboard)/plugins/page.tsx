"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, PackagePlus, PlugZap, ShieldCheck, Workflow } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  installCatalogPlugin,
  listCatalogItems,
  listPlugins,
  togglePlugin,
  type Plugin
} from "@/lib/api";
import { useLanguage } from "@/hooks/use-language";

export default function PluginsPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["plugins"],
    queryFn: listPlugins,
  });
  const { data: catalogItemsData } = useQuery({
    queryKey: ["catalog-items"],
    queryFn: listCatalogItems,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      togglePlugin(id, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plugins"] }),
  });
  const installMutation = useMutation({
    mutationFn: installCatalogPlugin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plugins"] });
      queryClient.invalidateQueries({ queryKey: ["catalog-items"] });
    },
  });

  const plugins = data?.plugins ?? [];
  const catalogPlugins = (catalogItemsData?.items ?? []).filter((item) => item.itemType === "plugin");

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("plugins.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("plugins.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("plugins.explanationTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>{t("plugins.explanation")}</p>
          <p>{t("plugins.whatItDoes")}</p>
          <p>{t("plugins.materializationNote")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("plugins.catalogInstall")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">{t("plugins.catalogInstallDescription")}</p>
          {installMutation.isSuccess && (
            <p className="text-muted-foreground">{t("plugins.catalogInstalled")}</p>
          )}
          {installMutation.isError && (
            <p className="text-destructive">
              {installMutation.error instanceof Error
                ? installMutation.error.message
                : t("plugins.catalogEmpty")}
            </p>
          )}
          {catalogPlugins.length === 0 ? (
            <p className="text-muted-foreground">{t("plugins.catalogEmpty")}</p>
          ) : (
            <div className="grid gap-2 lg:grid-cols-2">
              {catalogPlugins.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-md border border-border p-3 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{item.name}</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.description ?? item.externalId}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => installMutation.mutate(item.id)}
                    disabled={installMutation.isPending}
                  >
                    <PackagePlus className="size-4" />
                    {t("plugins.installCatalogItem")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("plugins.loading")}
          </CardContent>
        </Card>
      ) : plugins.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <PlugZap className="size-10 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-medium">{t("plugins.emptyTitle")}</h3>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {plugins.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              disabled={toggleMutation.isPending}
              onToggle={(enabled) => toggleMutation.mutate({ id: plugin.id, enabled })}
              categoryLabel={categoryLabel(plugin.category, t)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PluginCard({
  plugin,
  disabled,
  onToggle,
  categoryLabel,
}: {
  plugin: Plugin;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
  categoryLabel: string;
}) {
  const { t } = useLanguage();
  const Icon = plugin.category === "safety" ? ShieldCheck : plugin.category === "workflow" ? Workflow : PlugZap;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-md border border-border bg-muted/30 p-2">
              <Icon className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <CardTitle className="truncate text-base">{plugin.name}</CardTitle>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="outline">Claude Code</Badge>
                <Badge variant="secondary">{categoryLabel}</Badge>
              </div>
            </div>
          </div>
          <Switch checked={plugin.enabled} disabled={disabled} onCheckedChange={onToggle} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="min-h-12 text-muted-foreground">{plugin.description}</p>
        <div className="rounded-md border border-border p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <CheckCircle2 className="size-3" />
            {plugin.enabled ? t("plugins.enabled") : t("plugins.disabled")}
          </div>
          <div className="mt-2 break-all font-mono text-xs">{plugin.configPath}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function categoryLabel(category: Plugin["category"], t: ReturnType<typeof useLanguage>["t"]) {
  if (category === "workflow") return t("plugins.workflow");
  if (category === "safety") return t("plugins.safety");
  return t("plugins.integration");
}
