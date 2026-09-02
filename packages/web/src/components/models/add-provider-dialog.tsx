import { type FormEvent, useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import type { ProviderApiFormat, ProviderAuthType, ProviderSupportedAdapter } from "@/lib/api";
import {
  filterProviderPresets,
  providerPresets,
  providerPresetToForm,
  type ProviderPreset,
} from "@/lib/provider-presets";

import {
  adapterLabel,
  customProviderHasEndpoint,
  customProviderHasPlaintextHttp,
  slugifyProviderKey,
  type CredentialForm,
  type CustomProviderForm,
  type Translate,
} from "./shared";

const API_FORMATS: ProviderApiFormat[] = [
  "anthropic",
  "openai",
  "openai-compatible",
  "google",
  "bedrock",
  "local",
];

const AUTH_TYPES: ProviderAuthType[] = ["api_key", "bearer_token", "oauth", "none"];

const SUPPORTED_ADAPTERS: ProviderSupportedAdapter[] = ["claude", "opencode", "codex", "kimi"];

interface AddProviderDialogProps {
  open: boolean;
  customProvider: CustomProviderForm;
  setupCredential: CredentialForm;
  isCreating: boolean;
  onOpenChange: (open: boolean) => void;
  onCustomProviderChange: (form: CustomProviderForm) => void;
  onSetupCredentialChange: (form: CredentialForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  t: Translate;
}

export function AddProviderDialog({
  open,
  customProvider,
  setupCredential,
  isCreating,
  onOpenChange,
  onCustomProviderChange,
  onSetupCredentialChange,
  onSubmit,
  t,
}: AddProviderDialogProps) {
  const providerKeyTouched = useRef(false);
  const [presetQuery, setPresetQuery] = useState("");
  useEffect(() => {
    if (!open) {
      providerKeyTouched.current = false;
      setPresetQuery("");
    }
  }, [open]);

  const filteredPresets = filterProviderPresets(providerPresets, presetQuery);

  const requiresCredential = customProvider.authType !== "none";
  const hasEndpoint = customProviderHasEndpoint(customProvider);
  const hasPlaintextHttp = hasEndpoint && customProviderHasPlaintextHttp(customProvider);
  const canSubmit =
    !isCreating &&
    customProvider.name.trim().length > 0 &&
    customProvider.providerKey.trim().length > 0 &&
    hasEndpoint &&
    customProvider.supportedAdapters.length > 0;

  function handleNameChange(name: string) {
    onCustomProviderChange({
      ...customProvider,
      name,
      providerKey: providerKeyTouched.current ? customProvider.providerKey : slugifyProviderKey(name),
    });
  }

  function applyPreset(preset: ProviderPreset) {
    providerKeyTouched.current = true;
    onCustomProviderChange(providerPresetToForm(preset));
  }

  function toggleAdapter(adapter: ProviderSupportedAdapter) {
    const next = customProvider.supportedAdapters.includes(adapter)
      ? customProvider.supportedAdapters.filter((item) => item !== adapter)
      : [...customProvider.supportedAdapters, adapter];
    onCustomProviderChange({ ...customProvider, supportedAdapters: next });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form className="space-y-4" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{t("models.addProvider")}</DialogTitle>
            <DialogDescription>{t("models.addProviderDescription")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <span className="text-sm font-medium">{t("models.presets")}</span>
            <p className="text-xs text-muted-foreground">{t("models.presetsDescription")}</p>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={presetQuery}
                onChange={(event) => setPresetQuery(event.target.value)}
                placeholder={t("models.searchProviderPlaceholder")}
                className="h-9 pl-9"
              />
            </div>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border/70 p-1">
              {filteredPresets.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  {t("models.noPresetMatches")}
                </p>
              ) : (
                filteredPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className={`w-full rounded px-3 py-2 text-left hover:bg-muted/50 ${
                      customProvider.providerKey === preset.id ? "bg-muted/40" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{preset.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{preset.apiFormat}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {preset.openaiBaseUrl ?? preset.anthropicBaseUrl}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="provider-name">{t("common.name")}</Label>
              <Input
                id="provider-name"
                value={customProvider.name}
                onChange={(event) => handleNameChange(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="provider-key">{t("models.providerKey")}</Label>
              <Input
                id="provider-key"
                value={customProvider.providerKey}
                onChange={(event) => {
                  providerKeyTouched.current = true;
                  onCustomProviderChange({ ...customProvider, providerKey: event.target.value });
                }}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="provider-api-format">{t("models.apiFormat")}</Label>
              <select
                id="provider-api-format"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground"
                value={customProvider.apiFormat}
                onChange={(event) =>
                  onCustomProviderChange({ ...customProvider, apiFormat: event.target.value as ProviderApiFormat })
                }
              >
                {API_FORMATS.map((format) => (
                  <option key={format} value={format}>{format}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="provider-auth-type">{t("models.authType")}</Label>
              <select
                id="provider-auth-type"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground"
                value={customProvider.authType}
                onChange={(event) =>
                  onCustomProviderChange({ ...customProvider, authType: event.target.value as ProviderAuthType })
                }
              >
                {AUTH_TYPES.map((authType) => (
                  <option key={authType} value={authType}>{authType}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="provider-openai-base-url">{t("models.openaiBaseUrl")}</Label>
              <Input
                id="provider-openai-base-url"
                value={customProvider.openaiBaseUrl}
                onChange={(event) =>
                  onCustomProviderChange({ ...customProvider, openaiBaseUrl: event.target.value })
                }
                placeholder="https://example.com/v1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="provider-anthropic-base-url">{t("models.anthropicBaseUrl")}</Label>
              <Input
                id="provider-anthropic-base-url"
                value={customProvider.anthropicBaseUrl}
                onChange={(event) =>
                  onCustomProviderChange({ ...customProvider, anthropicBaseUrl: event.target.value })
                }
                placeholder="https://example.com/anthropic"
              />
            </div>
          </div>

          {!hasEndpoint && (
            <p className="text-xs text-destructive">{t("models.baseUrlRequired")}</p>
          )}

          {hasPlaintextHttp && (
            <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-brand"
                  checked={customProvider.allowPlaintextHttp}
                  onChange={(event) =>
                    onCustomProviderChange({ ...customProvider, allowPlaintextHttp: event.target.checked })
                  }
                />
                <span>{t("models.allowPlaintextHttp")}</span>
              </label>
              <p className="pl-6 text-xs text-muted-foreground">{t("models.allowPlaintextHttpHint")}</p>
            </div>
          )}

          <div className="space-y-2">
            <span className="text-sm font-medium">{t("models.supportedAdapters")}</span>
            <div className="flex flex-wrap gap-3">
              {SUPPORTED_ADAPTERS.map((adapter) => (
                <label key={adapter} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand"
                    checked={customProvider.supportedAdapters.includes(adapter)}
                    onChange={() => toggleAdapter(adapter)}
                  />
                  {adapterLabel(adapter)}
                </label>
              ))}
            </div>
          </div>

          {requiresCredential ? (
            <div className="grid gap-3 rounded-md border border-border/70 bg-muted/20 p-3">
              <div className="space-y-2">
                <Label htmlFor="setup-credential-label">{t("models.credentialLabel")}</Label>
                <Input
                  id="setup-credential-label"
                  value={setupCredential.label}
                  onChange={(event) =>
                    onSetupCredentialChange({ ...setupCredential, label: event.target.value })
                  }
                  placeholder={t("models.defaultCredentialLabel")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-api-key">{t("models.apiKey")}</Label>
                <Input
                  id="setup-api-key"
                  type="password"
                  value={setupCredential.plaintextSecret}
                  onChange={(event) =>
                    onSetupCredentialChange({ ...setupCredential, plaintextSecret: event.target.value })
                  }
                  placeholder={t("models.apiKeyPlaceholder")}
                />
                <p className="text-xs text-muted-foreground">{t("models.setupCredentialOptionalHint")}</p>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              {t("models.noCredentialRequired")}
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={!canSubmit}>
              {isCreating ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              {t("models.saveAndSyncModels")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
