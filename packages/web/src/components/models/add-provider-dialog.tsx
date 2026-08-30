import { type FormEvent } from "react";
import { ArrowLeft, Database, Plus, RefreshCw, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CliBrandChip } from "@/components/cli-brand-chip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProviderCatalogPreset } from "@/lib/api";
import {
  sourceLabelForProvider,
  type ProviderCatalogAdapterFilter,
  type ProviderCatalogConfiguredFilter,
  type ProviderCatalogResult,
  type ProviderCatalogSourceFilter,
} from "@/lib/model-provider-catalog";

import {
  EmptyLine,
  productTypeLabel,
  type CredentialForm,
  type CustomProviderForm,
  type Translate,
} from "./shared";

interface AddProviderDialogProps {
  open: boolean;
  pendingPreset: ProviderCatalogPreset | null;
  catalog: ProviderCatalogResult[];
  catalogCount: number;
  apiFormats: string[];
  queryText: string;
  adapterFilter: ProviderCatalogAdapterFilter;
  apiFormatFilter: string;
  sourceFilter: ProviderCatalogSourceFilter;
  configuredFilter: ProviderCatalogConfiguredFilter;
  isLoading: boolean;
  isAdding: boolean;
  customProvider: CustomProviderForm;
  isCreatingCustom: boolean;
  setupCredential: CredentialForm;
  onOpenChange: (open: boolean) => void;
  onQueryTextChange: (value: string) => void;
  onAdapterFilterChange: (value: ProviderCatalogAdapterFilter) => void;
  onApiFormatFilterChange: (value: string) => void;
  onSourceFilterChange: (value: ProviderCatalogSourceFilter) => void;
  onConfiguredFilterChange: (value: ProviderCatalogConfiguredFilter) => void;
  onAddPreset: (preset: ProviderCatalogPreset) => void;
  onSelectProvider: (providerId: string) => void;
  onCustomProviderChange: (form: CustomProviderForm) => void;
  onSubmitCustomProvider: (event: FormEvent<HTMLFormElement>) => void;
  onSetupCredentialChange: (form: CredentialForm) => void;
  onSubmitSetup: (event: FormEvent<HTMLFormElement>) => void;
  onBackToCatalog: () => void;
  t: Translate;
}

export function AddProviderDialog({
  open,
  pendingPreset,
  catalog,
  catalogCount,
  apiFormats,
  queryText,
  adapterFilter,
  apiFormatFilter,
  sourceFilter,
  configuredFilter,
  isLoading,
  isAdding,
  customProvider,
  isCreatingCustom,
  setupCredential,
  onOpenChange,
  onQueryTextChange,
  onAdapterFilterChange,
  onApiFormatFilterChange,
  onSourceFilterChange,
  onConfiguredFilterChange,
  onAddPreset,
  onSelectProvider,
  onCustomProviderChange,
  onSubmitCustomProvider,
  onSetupCredentialChange,
  onSubmitSetup,
  onBackToCatalog,
  t,
}: AddProviderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {pendingPreset ? (
          <SetupStep
            preset={pendingPreset}
            credential={setupCredential}
            isSaving={isAdding}
            onCredentialChange={onSetupCredentialChange}
            onSubmit={onSubmitSetup}
            onBack={onBackToCatalog}
            t={t}
          />
        ) : (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Database className="size-4 text-brand" />
                {t("models.providerCatalog")}
              </DialogTitle>
              <DialogDescription>{t("models.providerCatalogDescription")}</DialogDescription>
            </DialogHeader>

            <div className="grid items-start gap-2 md:grid-cols-2">
              <div className="flex h-full flex-col justify-end gap-1 text-xs text-muted-foreground">
                <span>{t("models.searchProviders")}</span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={queryText}
                    onChange={(event) => onQueryTextChange(event.target.value)}
                    placeholder={t("models.searchProviderPlaceholder")}
                    className="h-10 pl-9"
                  />
                </div>
              </div>
              <CatalogSelect
                label={t("models.catalogConfiguredFilter")}
                value={configuredFilter}
                onChange={(value) => onConfiguredFilterChange(value as ProviderCatalogConfiguredFilter)}
                options={[
                  ["all", t("common.all")],
                  ["configured", t("models.configuredProvider")],
                  ["not-configured", t("models.notConfiguredProvider")],
                ]}
              />
              <CatalogSelect
                label={t("common.aiTool")}
                value={adapterFilter}
                onChange={(value) => onAdapterFilterChange(value as ProviderCatalogAdapterFilter)}
                options={[
                  ["all", t("common.all")],
                  ["claude", "Claude Code"],
                  ["opencode", "OpenCode"],
                ]}
              />
              <CatalogSelect
                label={t("models.apiFormat")}
                value={apiFormatFilter}
                onChange={onApiFormatFilterChange}
                options={[["all", t("common.all")], ...apiFormats.map((format) => [format, format] as [string, string])]}
              />
              <CatalogSelect
                label={t("models.catalogSource")}
                value={sourceFilter}
                onChange={(value) => onSourceFilterChange(value as ProviderCatalogSourceFilter)}
                options={[
                  ["all", t("common.all")],
                  ["verified", t("models.verifiedCatalog")],
                  ["models.dev", "models.dev"],
                ]}
              />
              <div className="flex h-full items-end justify-start md:justify-end">
                <Badge variant="outline">
                  {catalog.length}/{catalogCount} {t("models.catalogMatches")}
                </Badge>
              </div>
            </div>

            <div className="max-h-[min(420px,45vh)] overflow-y-auto pr-1" data-testid="provider-catalog-list">
              {isLoading ? (
                <EmptyLine text={t("common.loading")} />
              ) : catalog.length === 0 ? (
                <EmptyLine text={t("models.noCatalogMatches")} />
              ) : (
                <div className="grid gap-2 lg:grid-cols-2">
                  {catalog.map((preset, index) => (
                    <div
                      key={preset.id}
                      className="flex min-h-[154px] flex-col justify-between gap-3 rounded-md border border-border/70 bg-muted/20 px-3 py-3 transition-colors forgebadger-animate-in hover:border-brand/30"
                      style={{ animationDelay: `${index * 40}ms` }}
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{preset.name}</div>
                            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{preset.description}</div>
                          </div>
                          {preset.configuredProvider ? (
                            <Badge>{t("models.configuredProvider")}</Badge>
                          ) : (
                            <Badge variant="outline">{t("models.notConfiguredProvider")}</Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {preset.supportedAdapters.map((adapter) => (
                            <CliBrandChip key={adapter} aiTool={adapter} />
                          ))}
                          <Badge variant="outline">{preset.apiFormat}</Badge>
                          <Badge variant={sourceLabelForProvider(preset) === "verified" ? "secondary" : "outline"}>
                            {sourceLabelForProvider(preset) === "verified" ? t("models.verifiedCatalog") : sourceLabelForProvider(preset)}
                          </Badge>
                          <Badge variant="outline">{preset.region}</Badge>
                          <Badge variant="outline">{productTypeLabel(preset.productType, t)}</Badge>
                          {preset.defaultModels[0] ? (
                            <Badge variant="outline">{preset.defaultModels[0].name}</Badge>
                          ) : null}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{preset.baseUrl}</div>
                      </div>
                      {preset.configuredProvider ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="w-full"
                          onClick={() => onSelectProvider(preset.configuredProvider?.id ?? "")}
                        >
                          {t("models.selectConfiguredProvider")}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="w-full"
                          disabled={isAdding}
                          onClick={() => onAddPreset(preset)}
                        >
                          <Plus className="size-4" />
                          {t("common.add")}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <details className="rounded-md border border-border/70 bg-muted/20 p-3">
              <summary className="cursor-pointer text-sm font-medium">{t("models.advancedCustomProvider")}</summary>
              <form className="mt-3 grid gap-3 md:grid-cols-3" onSubmit={onSubmitCustomProvider}>
                <div className="space-y-2">
                  <Label htmlFor="provider-name">{t("common.name")}</Label>
                  <Input
                    id="provider-name"
                    value={customProvider.name}
                    onChange={(event) => onCustomProviderChange({ ...customProvider, name: event.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="provider-key">{t("models.providerKey")}</Label>
                  <Input
                    id="provider-key"
                    value={customProvider.providerKey}
                    onChange={(event) => onCustomProviderChange({ ...customProvider, providerKey: event.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="provider-base-url">{t("models.endpoint")}</Label>
                  <Input
                    id="provider-base-url"
                    value={customProvider.baseUrl}
                    onChange={(event) => onCustomProviderChange({ ...customProvider, baseUrl: event.target.value })}
                    required
                  />
                </div>
                <Button className="md:col-span-3" type="submit" disabled={isCreatingCustom}>
                  <Plus className="size-4" />
                  {t("models.addCustomProvider")}
                </Button>
              </form>
            </details>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CatalogSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex h-full flex-col justify-end gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <select
        className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}

function SetupStep({
  preset,
  credential,
  isSaving,
  onCredentialChange,
  onSubmit,
  onBack,
  t,
}: {
  preset: ProviderCatalogPreset;
  credential: CredentialForm;
  isSaving: boolean;
  onCredentialChange: (credential: CredentialForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
  t: Translate;
}) {
  const requiresCredential = preset.authType !== "none";
  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <DialogHeader>
        <DialogTitle>{t("models.configureProviderTitle")} {preset.name}</DialogTitle>
        <DialogDescription>{t("models.configureProviderDescription")}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-2 rounded-md border border-border/70 bg-muted/20 p-3 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{productTypeLabel(preset.productType, t)}</Badge>
          <Badge variant="outline">{preset.region}</Badge>
          <Badge variant="outline">{preset.apiFormat}</Badge>
        </div>
        {preset.endpoints.anthropic?.baseUrl && (
          <div className="truncate text-xs text-muted-foreground">Anthropic: {preset.endpoints.anthropic.baseUrl}</div>
        )}
        {preset.endpoints.openai?.baseUrl && (
          <div className="truncate text-xs text-muted-foreground">OpenAI: {preset.endpoints.openai.baseUrl}</div>
        )}
      </div>

      {requiresCredential ? (
        <div className="grid gap-3">
          <div className="space-y-2">
            <Label htmlFor="setup-credential-label">{t("models.credentialLabel")}</Label>
            <Input
              id="setup-credential-label"
              value={credential.label}
              onChange={(event) => onCredentialChange({ ...credential, label: event.target.value })}
              placeholder={t("models.defaultCredentialLabel")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="setup-api-key">{t("models.apiKey")}</Label>
            <Input
              id="setup-api-key"
              type="password"
              value={credential.plaintextSecret}
              onChange={(event) => onCredentialChange({ ...credential, plaintextSecret: event.target.value })}
              placeholder={t("models.apiKeyPlaceholder")}
              required
            />
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
          {t("models.noCredentialRequired")}
        </div>
      )}

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          className="mr-auto"
          disabled={isSaving}
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
          {t("models.backToCatalog")}
        </Button>
        <Button
          type="submit"
          disabled={isSaving || (requiresCredential && !credential.plaintextSecret.trim())}
        >
          <RefreshCw className={`size-4 ${isSaving ? "animate-spin" : ""}`} />
          {t("models.saveAndSyncModels")}
        </Button>
      </DialogFooter>
    </form>
  );
}
