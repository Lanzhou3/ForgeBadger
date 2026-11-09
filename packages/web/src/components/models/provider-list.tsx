import { Pencil, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProviderProfile } from "@/lib/api";
import { cn } from "@/lib/utils";

import { EmptyLine, type Translate } from "./shared";

interface ProviderListProps {
  providers: ProviderProfile[];
  providerCount: number;
  modelCounts: Map<string, number>;
  queryText: string;
  selectedProviderId: string;
  isLoading: boolean;
  onQueryTextChange: (value: string) => void;
  onSelectProvider: (providerId: string) => void;
  onEditProvider: (providerId: string) => void;
  t: Translate;
}

export function ProviderList({
  providers,
  providerCount,
  modelCounts,
  queryText,
  selectedProviderId,
  isLoading,
  onQueryTextChange,
  onSelectProvider,
  onEditProvider,
  t,
}: ProviderListProps) {
  return (
    <div className="min-w-0 space-y-3 forgebadger-animate-in xl:sticky xl:top-4">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("models.providers")}
        </h2>
        <span className="text-[11px] tabular-nums text-muted-foreground/70">
          {providers.length}/{providerCount}
        </span>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={queryText}
          onChange={(event) => onQueryTextChange(event.target.value)}
          placeholder={t("models.searchConfiguredProviders")}
          aria-label={t("models.searchConfiguredProviders")}
          className="h-8 rounded-lg pl-8 text-sm"
        />
      </div>
      <div data-testid="configured-provider-list" className="max-h-[560px] overflow-y-auto">
        {isLoading ? (
          <EmptyLine text={t("common.loading")} />
        ) : providers.length === 0 ? (
          <EmptyLine text={t("models.emptyProviders")} />
        ) : (
          <div className="space-y-0.5">
            {providers.map((provider, index) => {
              const isSelected = provider.id === selectedProviderId;
              return (
                <div
                  key={provider.id}
                  className={cn(
                    "group relative flex w-full items-center gap-2.5 rounded-lg py-2 pl-3 pr-1.5 text-sm transition-colors forgebadger-animate-in",
                    isSelected ? "bg-accent" : "hover:bg-muted/50"
                  )}
                  style={{ animationDelay: `${index * 40}ms` }}
                >
                  {isSelected && (
                    <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-brand" aria-hidden="true" />
                  )}
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand/10 text-xs font-semibold text-brand" aria-hidden="true">
                    {provider.name.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onSelectProvider(provider.id)}
                  >
                    <span className={cn("block truncate", isSelected && "font-medium")}>
                      {provider.name}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {provider.baseUrl ?? provider.providerKey}
                    </span>
                  </button>
                  <span
                    className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70"
                    title={t("models.modelsWorkspace")}
                  >
                    {modelCounts.get(provider.id) ?? 0}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0 text-muted-foreground opacity-100 transition-opacity hover:text-foreground md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                    title={t("common.edit")}
                    aria-label={t("common.edit")}
                    onClick={() => onEditProvider(provider.id)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
