import { Cloud, Search, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ProviderProfile } from "@/lib/api";

import { EmptyLine, type Translate } from "./shared";

interface ProviderListProps {
  providers: ProviderProfile[];
  providerCount: number;
  modelCounts: Map<string, number>;
  queryText: string;
  selectedProviderId: string;
  isLoading: boolean;
  isDeleting: boolean;
  onQueryTextChange: (value: string) => void;
  onSelectProvider: (providerId: string) => void;
  onDeleteProvider: (providerId: string) => void;
  t: Translate;
}

export function ProviderList({
  providers,
  providerCount,
  modelCounts,
  queryText,
  selectedProviderId,
  isLoading,
  isDeleting,
  onQueryTextChange,
  onSelectProvider,
  onDeleteProvider,
  t,
}: ProviderListProps) {
  return (
    <Card className="min-w-0 forgebadger-animate-in xl:sticky xl:top-4">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
            <Cloud className="size-4" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base">{t("models.providers")}</CardTitle>
            <CardDescription className="mt-1">{t("models.providersDescription")}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={queryText}
            onChange={(event) => onQueryTextChange(event.target.value)}
            placeholder={t("models.searchConfiguredProviders")}
            className="pl-9"
          />
        </div>
        <div className="text-xs text-muted-foreground">
          {providers.length}/{providerCount} {t("models.catalogMatches")}
        </div>
        <div data-testid="configured-provider-list" className="max-h-[560px] overflow-y-auto">
          {isLoading ? (
            <EmptyLine text={t("common.loading")} />
          ) : providers.length === 0 ? (
            <EmptyLine text={t("models.emptyProviders")} />
          ) : (
            <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
              {providers.map((provider, index) => {
                const isSelected = provider.id === selectedProviderId;
                return (
                  <div
                    key={provider.id}
                    className={`flex w-full items-center gap-2 px-3 py-2.5 text-sm transition-colors forgebadger-animate-in ${
                      isSelected ? "bg-brand/5" : "hover:bg-muted/40"
                    }`}
                    style={{ animationDelay: `${index * 40}ms` }}
                  >
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${isSelected ? "bg-brand" : "bg-muted-foreground/30"}`}
                    />
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      className="min-w-0 flex-1 text-left"
                      onClick={() => onSelectProvider(provider.id)}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{provider.name}</span>
                        <Badge
                          variant="outline"
                          title={t("models.modelsWorkspace")}
                          className="shrink-0 text-[10px]"
                        >
                          {modelCounts.get(provider.id) ?? 0} {t("models.modelUnit")}
                        </Badge>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {provider.baseUrl ?? provider.providerKey}
                      </span>
                    </button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={isDeleting}
                      title={t("models.deleteProviderInlineLabel")}
                      aria-label={t("models.deleteProviderInlineLabel")}
                      onClick={() => onDeleteProvider(provider.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
