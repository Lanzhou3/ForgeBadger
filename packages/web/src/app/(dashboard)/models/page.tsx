"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Braces,
  CheckCircle2,
  Cloud,
  Database,
  ExternalLink,
  KeyRound,
  Layers3,
  Play,
  Plus,
  RefreshCw,
  Search,
  ServerCog,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLanguage } from "@/hooks/use-language";
import {
  applyProviderConfig,
  checkModelProviderReadiness,
  createModelProvider,
  createProviderCredential,
  createProviderModel,
  deleteProviderCredential,
  deleteProviderModel,
  deleteModelProvider,
  getCodexSubscriptionStatus,
  listModelProviders,
  listProviderCatalog,
  previewProviderApply,
  rotateProviderCredential,
  setDefaultProviderModel,
  syncProviderModels,
  updateProviderModel,
  type CodexSubscriptionStatus,
  type ModelProviderReadiness,
  type ModelProfile,
  type ProviderApplyPreview,
  type ProviderApplyAdapter,
  type ProviderCatalogPreset,
  type ProviderCredentialSummary,
  type ProviderProfile,
  type ProviderSupportedAdapter,
} from "@/lib/api";
import {
  buildConfiguredProviderMap,
  filterProviderCatalog,
  isCopilotCompatibleProvider,
  sourceLabelForProvider,
  type ProviderCatalogAdapterFilter,
  type ProviderCatalogConfiguredFilter,
  type ProviderCatalogResult,
  type ProviderCatalogSourceFilter,
} from "@/lib/model-provider-catalog";

interface CustomProviderForm {
  name: string;
  providerKey: string;
  baseUrl: string;
}

interface CredentialForm {
  label: string;
  plaintextSecret: string;
}

interface ModelForm {
  name: string;
  modelId: string;
  capabilities: string;
}

const emptyCustomProvider: CustomProviderForm = {
  name: "",
  providerKey: "",
  baseUrl: "",
};

const emptyCredential: CredentialForm = {
  label: "",
  plaintextSecret: "",
};

const emptyModel: ModelForm = {
  name: "",
  modelId: "",
  capabilities: "chat,code",
};

export default function ModelsPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [customProvider, setCustomProvider] = useState<CustomProviderForm>(emptyCustomProvider);
  const [credentialForm, setCredentialForm] = useState<CredentialForm>(emptyCredential);
  const [modelForm, setModelForm] = useState<ModelForm>(emptyModel);
  const [projectRoot, setProjectRoot] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedCredentialId, setSelectedCredentialId] = useState("");
  const [selectedApplyAdapter, setSelectedApplyAdapter] = useState<ProviderApplyAdapter>("claude");
  const [applyPreview, setApplyPreview] = useState<ProviderApplyPreview | null>(null);
  const [providerReadiness, setProviderReadiness] = useState<ModelProviderReadiness | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [providerQueryText, setProviderQueryText] = useState("");
  const [catalogQueryText, setCatalogQueryText] = useState("");
  const [catalogAdapterFilter, setCatalogAdapterFilter] = useState<ProviderCatalogAdapterFilter>("all");
  const [catalogFormatFilter, setCatalogFormatFilter] = useState("all");
  const [catalogSourceFilter, setCatalogSourceFilter] = useState<ProviderCatalogSourceFilter>("verified");
  const [catalogConfiguredFilter, setCatalogConfiguredFilter] = useState<ProviderCatalogConfiguredFilter>("all");
  const [pendingPreset, setPendingPreset] = useState<ProviderCatalogPreset | null>(null);
  const [setupCredentialForm, setSetupCredentialForm] = useState<CredentialForm>(emptyCredential);

  const providerQuery = useQuery({
    queryKey: ["model-providers"],
    queryFn: listModelProviders,
  });
  const catalogQuery = useQuery({
    queryKey: ["model-provider-catalog"],
    queryFn: listProviderCatalog,
  });
  const codexSubscriptionQuery = useQuery({
    queryKey: ["codex-subscription-status"],
    queryFn: getCodexSubscriptionStatus,
  });
  const providers = providerQuery.data?.providers ?? [];
  const models = providerQuery.data?.models ?? [];
  const credentials = providerQuery.data?.credentials ?? [];
  const catalog = catalogQuery.data?.providers ?? [];
  const filteredProviders = useMemo(() => {
    const query = providerQueryText.trim().toLowerCase();
    if (!query) return providers;
    return providers.filter((provider) =>
      [provider.name, provider.providerKey, provider.baseUrl, provider.apiFormat, provider.opencodeNpm]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [providerQueryText, providers]);
  const configuredProviderMap = useMemo(() => buildConfiguredProviderMap(providers), [providers]);
  const filteredCatalog = useMemo(
    () =>
      filterProviderCatalog(catalog, configuredProviderMap, {
        query: catalogQueryText,
        adapter: catalogAdapterFilter,
        apiFormat: catalogFormatFilter,
        source: catalogSourceFilter,
        configured: catalogConfiguredFilter,
      }),
    [catalog, configuredProviderMap, catalogAdapterFilter, catalogConfiguredFilter, catalogFormatFilter, catalogQueryText, catalogSourceFilter]
  );
  const catalogApiFormats = useMemo(
    () => Array.from(new Set(catalog.map((provider) => provider.apiFormat))).sort(),
    [catalog]
  );

  useEffect(() => {
    if (!selectedProviderId && providers[0]) {
      setSelectedProviderId(providers[0].id);
    }
  }, [providers, selectedProviderId]);

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const providerModels = useMemo(
    () => models.filter((model) => model.providerProfileId === selectedProviderId),
    [models, selectedProviderId]
  );
  const providerCredentials = useMemo(
    () => credentials.filter((credential) => credential.providerProfileId === selectedProviderId),
    [credentials, selectedProviderId]
  );
  const selectedModel = useMemo(
    () => providerModels.find((model) => model.id === selectedModelId),
    [providerModels, selectedModelId]
  );
  const selectedCredential = useMemo(
    () => providerCredentials.find((credential) => credential.id === selectedCredentialId),
    [providerCredentials, selectedCredentialId]
  );

  useEffect(() => {
    setSelectedModelId((current) =>
      providerModels.some((model) => model.id === current) ? current : providerModels[0]?.id || ""
    );
    setSelectedCredentialId((current) =>
      providerCredentials.some((credential) => credential.id === current) ? current : providerCredentials[0]?.id || ""
    );
    setApplyPreview(null);
    setProviderReadiness(null);
  }, [providerModels, providerCredentials]);

  useEffect(() => {
    if (!selectedProvider) {
      setSelectedApplyAdapter("claude");
      return;
    }
    const targets = applyTargetsForProvider(selectedProvider);
    setSelectedApplyAdapter((current) => targets.includes(current) ? current : targets[0] ?? "claude");
  }, [selectedProvider]);

  useEffect(() => {
    setProviderReadiness(null);
  }, [selectedApplyAdapter, selectedCredentialId, selectedModelId, selectedProviderId]);

  useEffect(() => {
    if (selectedModel) {
      setModelForm({
        name: selectedModel.name,
        modelId: selectedModel.modelId,
        capabilities: selectedModel.capabilities.join(","),
      });
    } else {
      setModelForm(emptyModel);
    }
  }, [selectedModel]);

  useEffect(() => {
    if (selectedCredential) {
      setCredentialForm((form) => ({ ...form, label: selectedCredential.label ?? "" }));
    }
  }, [selectedCredential]);

  const addPresetMutation = useMutation({
    mutationFn: async (input: { preset: ProviderCatalogPreset; credential: CredentialForm }) => {
      const created = await createModelProvider({ catalogId: input.preset.id });
      const credential =
        created.provider.authType === "none"
          ? undefined
          : (await createProviderCredential(created.provider.id, {
            label: input.credential.label.trim() || undefined,
            plaintextSecret: input.credential.plaintextSecret,
          })).credential;
      const syncResult = await syncProviderModels(created.provider.id, {
        ...(credential ? { credentialId: credential.id } : {}),
      });
      return { provider: created.provider, credential, models: syncResult.models };
    },
    onSuccess: async (result) => {
      setSelectedProviderId(result.provider.id);
      setSelectedCredentialId(result.credential?.id ?? "");
      setSelectedModelId(result.models[0]?.id ?? "");
      setPendingPreset(null);
      setSetupCredentialForm(emptyCredential);
      setNotice(t("models.providerConfigured"));
      await refreshProviders();
    },
  });

  const customProviderMutation = useMutation({
    mutationFn: () =>
      createModelProvider({
        name: customProvider.name.trim(),
        providerKey: customProvider.providerKey.trim(),
        baseUrl: customProvider.baseUrl.trim(),
        authType: "api_key",
        apiFormat: "anthropic",
        supportedAdapters: ["claude"],
      }),
    onSuccess: async (result) => {
      setCustomProvider(emptyCustomProvider);
      setSelectedProviderId(result.provider.id);
      setNotice(t("models.providerCreated"));
      await refreshProviders();
    },
  });

  const deleteProviderMutation = useMutation({
    mutationFn: (providerId: string) => deleteModelProvider(providerId),
    onSuccess: async (_result, providerId) => {
      const nextProviderId = providers.find((provider) => provider.id !== providerId)?.id || "";
      setSelectedProviderId(nextProviderId);
      setSelectedModelId("");
      setSelectedCredentialId("");
      setApplyPreview(null);
      setNotice(t("models.providerDeleted"));
      await refreshProviders();
    },
  });

  const credentialMutation = useMutation({
    mutationFn: () =>
      createProviderCredential(selectedProviderId, {
        label: credentialForm.label.trim() || undefined,
        plaintextSecret: credentialForm.plaintextSecret,
      }),
    onSuccess: async (result) => {
      setCredentialForm(emptyCredential);
      setSelectedCredentialId(result.credential.id);
      setNotice(t("models.credentialSaved"));
      await refreshProviders();
    },
  });

  const rotateCredentialMutation = useMutation({
    mutationFn: () => {
      if (!selectedCredentialId) throw new Error(t("models.credentialRequired"));
      return rotateProviderCredential(selectedProviderId, selectedCredentialId, {
        label: credentialForm.label.trim() || undefined,
        plaintextSecret: credentialForm.plaintextSecret,
      });
    },
    onSuccess: async (result) => {
      setCredentialForm(emptyCredential);
      setSelectedCredentialId(result.credential.id);
      setNotice(t("models.credentialRotated"));
      await refreshProviders();
    },
  });

  const deleteCredentialMutation = useMutation({
    mutationFn: (credentialId: string) => deleteProviderCredential(selectedProviderId, credentialId),
    onSuccess: async (_result, credentialId) => {
      const nextCredentialId = providerCredentials.find((credential) => credential.id !== credentialId)?.id || "";
      setSelectedCredentialId(nextCredentialId);
      setCredentialForm(emptyCredential);
      setNotice(t("models.credentialDeleted"));
      await refreshProviders();
    },
  });

  const modelMutation = useMutation({
    mutationFn: () =>
      createProviderModel(selectedProviderId, {
        name: modelForm.name.trim(),
        modelId: modelForm.modelId.trim(),
        capabilities: modelForm.capabilities
          .split(",")
          .map((capability) => capability.trim())
          .filter(Boolean),
      }),
    onSuccess: async (result) => {
      setModelForm(emptyModel);
      setSelectedModelId(result.model.id);
      setNotice(t("models.modelProfileSaved"));
      await refreshProviders();
    },
  });

  const updateModelMutation = useMutation({
    mutationFn: () => {
      if (!selectedModelId) throw new Error(t("models.modelRequired"));
      return updateProviderModel(selectedProviderId, selectedModelId, {
        name: modelForm.name.trim(),
        modelId: modelForm.modelId.trim(),
        capabilities: modelForm.capabilities
          .split(",")
          .map((capability) => capability.trim())
          .filter(Boolean),
      });
    },
    onSuccess: async (result) => {
      setSelectedModelId(result.model.id);
      setNotice(t("models.updated"));
      await refreshProviders();
    },
  });

  const deleteModelMutation = useMutation({
    mutationFn: (modelId: string) => deleteProviderModel(selectedProviderId, modelId),
    onSuccess: async (_result, modelId) => {
      const nextModelId = providerModels.find((model) => model.id !== modelId)?.id || "";
      setSelectedModelId(nextModelId);
      setModelForm(nextModelId ? modelForm : emptyModel);
      setNotice(t("models.deleted"));
      await refreshProviders();
    },
  });

  const setDefaultModelMutation = useMutation({
    mutationFn: (modelId: string) => setDefaultProviderModel(selectedProviderId, modelId),
    onSuccess: async (result) => {
      setSelectedModelId(result.model.id);
      setNotice(t("models.defaultUpdated"));
      await refreshProviders();
    },
  });

  const syncModelsMutation = useMutation({
    mutationFn: () => {
      if (!selectedProvider) throw new Error(t("models.providerRequired"));
      return syncProviderModels(selectedProvider.id, {
        credentialId: selectedProvider.authType === "none" ? undefined : selectedCredentialId || undefined,
      });
    },
    onSuccess: async (result) => {
      setNotice(result.createdCount > 0 ? t("models.modelSyncComplete") : t("models.modelSyncNoChanges"));
      await refreshProviders();
    },
  });

  const previewMutation = useMutation({
    mutationFn: () => {
      if (!selectedProviderId) throw new Error(t("models.providerRequired"));
      return previewProviderApply(
        selectedProviderId,
        buildApplyPayload(selectedApplyAdapter, projectRoot, selectedModelId, selectedCredentialId)
      );
    },
    onSuccess: (result) => {
      setApplyPreview(result.preview);
      setNotice(t("models.previewReady"));
    },
  });

  const applyMutation = useMutation({
    mutationFn: () => {
      if (!selectedProviderId) throw new Error(t("models.providerRequired"));
      return applyProviderConfig(
        selectedProviderId,
        buildApplyPayload(selectedApplyAdapter, projectRoot, selectedModelId, selectedCredentialId)
      );
    },
    onSuccess: (result) => {
      setApplyPreview(result.result);
      setNotice(t("models.applyComplete"));
    },
  });

  const readinessMutation = useMutation({
    mutationFn: () => {
      if (!selectedProviderId) throw new Error(t("models.providerRequired"));
      return checkModelProviderReadiness(selectedProviderId, {
        adapter: selectedApplyAdapter,
        ...(selectedModelId ? { modelProfileId: selectedModelId } : {}),
        ...(selectedCredentialId ? { credentialId: selectedCredentialId } : {}),
        includeRemoteCheck: true,
        timeoutMs: 5000,
      });
    },
    onSuccess: (result) => {
      setProviderReadiness(result.readiness);
      setNotice(result.readiness.status === "ready"
        ? t("models.providerReadinessReadyNotice")
        : t("models.providerReadinessNeedsAttentionNotice")
      );
    },
  });

  function refreshProviders() {
    setApplyPreview(null);
    setProviderReadiness(null);
    return queryClient.invalidateQueries({ queryKey: ["model-providers"] });
  }

  function submitCustomProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    customProviderMutation.mutate();
  }

  function submitPresetSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingPreset) return;
    addPresetMutation.mutate({ preset: pendingPreset, credential: setupCredentialForm });
  }

  function submitCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    credentialMutation.mutate();
  }

  function submitModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedModelId) {
      updateModelMutation.mutate();
    } else {
      modelMutation.mutate();
    }
  }

  const currentError =
    providerQuery.error ??
    catalogQuery.error ??
    addPresetMutation.error ??
    customProviderMutation.error ??
    deleteProviderMutation.error ??
    credentialMutation.error ??
    rotateCredentialMutation.error ??
    deleteCredentialMutation.error ??
    modelMutation.error ??
    updateModelMutation.error ??
    deleteModelMutation.error ??
    setDefaultModelMutation.error ??
    syncModelsMutation.error ??
    previewMutation.error ??
    applyMutation.error ??
    readinessMutation.error;
  return (
    <div className="space-y-5 overflow-x-hidden p-4 pt-16 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("models.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("models.providerCenterSubtitle")}</p>
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="size-4" />
          {notice}
        </div>
      )}

      {currentError instanceof Error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {currentError.message}
        </div>
      )}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_360px]">
        <ProviderColumn
          providers={filteredProviders}
          providerCount={providers.length}
          queryText={providerQueryText}
          selectedProviderId={selectedProviderId}
          isLoading={providerQuery.isLoading || catalogQuery.isLoading}
          isDeleting={deleteProviderMutation.isPending}
          onQueryTextChange={setProviderQueryText}
          onSelectProvider={setSelectedProviderId}
          onDeleteProvider={(providerId) => {
            if (window.confirm(t("models.deleteProviderConfirm"))) {
              deleteProviderMutation.mutate(providerId);
            }
          }}
          t={t}
        />

        <div className="min-w-0 space-y-4">
          <ProviderCatalogBrowser
            catalog={filteredCatalog}
            catalogCount={catalog.length}
            apiFormats={catalogApiFormats}
            queryText={catalogQueryText}
            adapterFilter={catalogAdapterFilter}
            apiFormatFilter={catalogFormatFilter}
            sourceFilter={catalogSourceFilter}
            configuredFilter={catalogConfiguredFilter}
            isLoading={catalogQuery.isLoading}
            isAdding={addPresetMutation.isPending}
            onQueryTextChange={setCatalogQueryText}
            onAdapterFilterChange={setCatalogAdapterFilter}
            onApiFormatFilterChange={setCatalogFormatFilter}
            onSourceFilterChange={setCatalogSourceFilter}
            onConfiguredFilterChange={setCatalogConfiguredFilter}
            onAddPreset={(preset) => {
              setPendingPreset(preset);
              setSetupCredentialForm({
                label: preset.productType === "subscription" ? t("models.subscriptionCredentialLabel") : "",
                plaintextSecret: "",
              });
            }}
            onSelectProvider={setSelectedProviderId}
            t={t}
          />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ServerCog className="size-5" />
                {t("models.providerProfile")}
              </CardTitle>
              <CardDescription>{t("models.providerProfileDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              {selectedProvider ? (
                <ProviderSummary
                  provider={selectedProvider}
                  modelCount={providerModels.length}
                  credentialCount={providerCredentials.length}
                  isDeleting={deleteProviderMutation.isPending}
                  onDelete={() => {
                    if (window.confirm(t("models.deleteProviderConfirm"))) {
                      deleteProviderMutation.mutate(selectedProvider.id);
                    }
                  }}
                  t={t}
                />
              ) : (
                <EmptyLine text={t("models.noProviderSelected")} />
              )}
              <details className="mt-4 rounded-md border bg-muted/10 p-3">
                <summary className="cursor-pointer text-sm font-medium">{t("models.advancedCustomProvider")}</summary>
                <form className="mt-3 grid gap-3 md:grid-cols-3" onSubmit={submitCustomProvider}>
                  <div className="space-y-2">
                    <Label htmlFor="provider-name">{t("common.name")}</Label>
                    <Input
                      id="provider-name"
                      value={customProvider.name}
                      onChange={(event) => setCustomProvider((form) => ({ ...form, name: event.target.value }))}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="provider-key">{t("models.providerKey")}</Label>
                    <Input
                      id="provider-key"
                      value={customProvider.providerKey}
                      onChange={(event) => setCustomProvider((form) => ({ ...form, providerKey: event.target.value }))}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="provider-base-url">{t("models.endpoint")}</Label>
                    <Input
                      id="provider-base-url"
                      value={customProvider.baseUrl}
                      onChange={(event) => setCustomProvider((form) => ({ ...form, baseUrl: event.target.value }))}
                      required
                    />
                  </div>
                  <Button className="md:col-span-3" type="submit" disabled={customProviderMutation.isPending}>
                    <Plus className="size-4" />
                    {t("models.addCustomProvider")}
                  </Button>
                </form>
              </details>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="size-5" />
                {t("models.credentials")}
              </CardTitle>
              <CardDescription>{t("models.credentialsDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form className="grid items-end gap-3 md:grid-cols-[1fr_1fr_auto_auto]" onSubmit={submitCredential}>
                <div className="space-y-2">
                  <Label htmlFor="credential-label">{t("models.credentialLabel")}</Label>
                  <Input
                    id="credential-label"
                    placeholder={t("models.defaultCredentialLabel")}
                    value={credentialForm.label}
                    onChange={(event) => setCredentialForm((form) => ({ ...form, label: event.target.value }))}
                    disabled={!selectedProvider}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="credential-secret">{t("models.apiKey")}</Label>
                  <Input
                    id="credential-secret"
                    type="password"
                    placeholder={t("models.apiKeyPlaceholder")}
                    value={credentialForm.plaintextSecret}
                    onChange={(event) => setCredentialForm((form) => ({ ...form, plaintextSecret: event.target.value }))}
                    disabled={!selectedProvider}
                    required
                  />
                </div>
                <Button type="submit" disabled={!selectedProvider || credentialMutation.isPending}>
                  <Plus className="size-4" />
                  {t("models.saveCredential")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!selectedCredentialId || !credentialForm.plaintextSecret || rotateCredentialMutation.isPending}
                  onClick={() => rotateCredentialMutation.mutate()}
                >
                  <RefreshCw className="size-4" />
                  {t("models.rotateSelectedCredential")}
                </Button>
              </form>
              <CredentialTable
                credentials={providerCredentials}
                selectedCredentialId={selectedCredentialId}
                onSelectCredential={setSelectedCredentialId}
                onDeleteCredential={(credentialId) => {
                  if (window.confirm(t("models.deleteCredentialConfirm"))) {
                    deleteCredentialMutation.mutate(credentialId);
                  }
                }}
                isDeleting={deleteCredentialMutation.isPending}
                t={t}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers3 className="size-5" />
                {t("models.modelsWorkspace")}
              </CardTitle>
              <CardDescription>{t("models.modelsWorkspaceDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <details className="rounded-md border bg-muted/10 p-3">
                <summary className="cursor-pointer text-sm font-medium">{t("models.advancedModelEditor")}</summary>
                <form className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto_auto]" onSubmit={submitModel}>
                  <Input
                    placeholder={t("common.name")}
                    value={modelForm.name}
                    onChange={(event) => setModelForm((form) => ({ ...form, name: event.target.value }))}
                    disabled={!selectedProvider}
                    required
                  />
                  <Input
                    placeholder={t("models.modelId")}
                    value={modelForm.modelId}
                    onChange={(event) => setModelForm((form) => ({ ...form, modelId: event.target.value }))}
                    disabled={!selectedProvider}
                    required
                  />
                  <Input
                    placeholder={t("models.capabilities")}
                    value={modelForm.capabilities}
                    onChange={(event) => setModelForm((form) => ({ ...form, capabilities: event.target.value }))}
                    disabled={!selectedProvider}
                  />
                  <Button
                    type="submit"
                    disabled={!selectedProvider || modelMutation.isPending || updateModelMutation.isPending}
                  >
                    {selectedModelId ? <CheckCircle2 className="size-4" /> : <Plus className="size-4" />}
                    {selectedModelId ? t("models.saveModel") : t("models.addModel")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!selectedProvider}
                    onClick={() => {
                      setSelectedModelId("");
                      setModelForm(emptyModel);
                    }}
                  >
                    <Plus className="size-4" />
                    {t("models.newModel")}
                  </Button>
                </form>
              </details>
              <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2 text-sm">
                <div className="text-muted-foreground">{t("models.syncProviderModelsDescription")}</div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    !selectedProvider ||
                    syncModelsMutation.isPending ||
                    (selectedProvider.authType !== "none" && !selectedCredentialId)
                  }
                  onClick={() => syncModelsMutation.mutate()}
                >
                  <RefreshCw className={`size-4 ${syncModelsMutation.isPending ? "animate-spin" : ""}`} />
                  {t("models.syncProviderModels")}
                </Button>
              </div>
              <ModelProfileTable
                models={providerModels}
                selectedModelId={selectedModelId}
                onSelectModel={setSelectedModelId}
                onSetDefault={(modelId) => setDefaultModelMutation.mutate(modelId)}
                onDeleteModel={(modelId) => {
                  if (window.confirm(t("models.deleteModelConfirm"))) {
                    deleteModelMutation.mutate(modelId);
                  }
                }}
                isSettingDefault={setDefaultModelMutation.isPending}
                isDeleting={deleteModelMutation.isPending}
                t={t}
              />
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 xl:col-start-2 2xl:col-start-auto">
          <div className="space-y-4">
            <ProviderHealthCard
              readiness={providerReadiness}
              isChecking={readinessMutation.isPending}
              canCheck={Boolean(selectedProvider)}
              onCheck={() => readinessMutation.mutate()}
              t={t}
            />
            <CodexIdentityCard
              status={codexSubscriptionQuery.data?.status}
              isLoading={codexSubscriptionQuery.isLoading}
              t={t}
            />
            <ApplyColumn
              provider={selectedProvider}
              models={providerModels}
              credentials={providerCredentials}
              projectRoot={projectRoot}
              selectedModelId={selectedModelId}
              selectedCredentialId={selectedCredentialId}
              selectedAdapter={selectedApplyAdapter}
              preview={applyPreview}
              isPreviewing={previewMutation.isPending}
              isApplying={applyMutation.isPending}
              onProjectRootChange={setProjectRoot}
              onModelChange={setSelectedModelId}
              onCredentialChange={setSelectedCredentialId}
              onAdapterChange={setSelectedApplyAdapter}
              onPreview={() => previewMutation.mutate()}
              onApply={() => applyMutation.mutate()}
              t={t}
            />
          </div>
        </div>
      </div>
      <ProviderSetupDialog
        preset={pendingPreset}
        credential={setupCredentialForm}
        isSaving={addPresetMutation.isPending}
        onCredentialChange={setSetupCredentialForm}
        onOpenChange={(open) => {
          if (!open && !addPresetMutation.isPending) {
            setPendingPreset(null);
            setSetupCredentialForm(emptyCredential);
          }
        }}
        onSubmit={submitPresetSetup}
        t={t}
      />
    </div>
  );
}

interface ProviderColumnProps {
  providers: ProviderProfile[];
  providerCount: number;
  queryText: string;
  selectedProviderId: string;
  isLoading: boolean;
  isDeleting: boolean;
  onQueryTextChange: (value: string) => void;
  onSelectProvider: (providerId: string) => void;
  onDeleteProvider: (providerId: string) => void;
  t: (key: any) => string;
}

function ProviderColumn({
  providers,
  providerCount,
  queryText,
  selectedProviderId,
  isLoading,
  isDeleting,
  onQueryTextChange,
  onSelectProvider,
  onDeleteProvider,
  t
}: ProviderColumnProps) {
  return (
    <Card className="min-w-0 xl:sticky xl:top-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="size-5" />
          {t("models.providers")}
        </CardTitle>
        <CardDescription>{t("models.providersDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
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
        <div data-testid="configured-provider-list" className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
          {isLoading ? (
            <EmptyLine text={t("common.loading")} />
          ) : providers.length === 0 ? (
            <EmptyLine text={t("models.emptyProviders")} />
          ) : (
            providers.map((provider) => (
              <div
                key={provider.id}
                className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                  provider.id === selectedProviderId
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted"
                }`}
              >
                <button
                  type="button"
                  aria-pressed={provider.id === selectedProviderId}
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onSelectProvider(provider.id)}
                >
                  <span className="block font-medium">{provider.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{provider.baseUrl ?? provider.providerKey}</span>
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
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ProviderCatalogBrowser({
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
  onQueryTextChange,
  onAdapterFilterChange,
  onApiFormatFilterChange,
  onSourceFilterChange,
  onConfiguredFilterChange,
  onAddPreset,
  onSelectProvider,
  t,
}: {
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
  onQueryTextChange: (value: string) => void;
  onAdapterFilterChange: (value: ProviderCatalogAdapterFilter) => void;
  onApiFormatFilterChange: (value: string) => void;
  onSourceFilterChange: (value: ProviderCatalogSourceFilter) => void;
  onConfiguredFilterChange: (value: ProviderCatalogConfiguredFilter) => void;
  onAddPreset: (preset: ProviderCatalogPreset) => void;
  onSelectProvider: (providerId: string) => void;
  t: (key: any) => string;
}) {
  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("models.providerCatalog")}</CardTitle>
            <CardDescription>{t("models.providerCatalogDescription")}</CardDescription>
          </div>
          <Badge variant="outline">
            {catalog.length}/{catalogCount} {t("models.catalogMatches")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid items-start gap-2 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_repeat(4,minmax(132px,auto))]">
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
              ["openforge-copilot", "OpenForge Copilot"],
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
        </div>

        <div className="max-h-[520px] overflow-auto pr-1" data-testid="provider-catalog-list">
          {isLoading ? (
            <EmptyLine text={t("common.loading")} />
          ) : catalog.length === 0 ? (
            <EmptyLine text={t("models.noCatalogMatches")} />
          ) : (
            <div className="grid gap-2 lg:grid-cols-2">
              {catalog.map((preset) => (
                <div key={preset.id} className="flex min-h-[154px] flex-col justify-between gap-3 rounded-md border bg-muted/10 px-3 py-3">
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
                        <Badge key={adapter} variant={adapter === "claude" ? "default" : "secondary"}>
                          {adapterLabel(adapter)}
                        </Badge>
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
      </CardContent>
    </Card>
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

function ProviderSetupDialog({
  preset,
  credential,
  isSaving,
  onCredentialChange,
  onOpenChange,
  onSubmit,
  t,
}: {
  preset: ProviderCatalogPreset | null;
  credential: CredentialForm;
  isSaving: boolean;
  onCredentialChange: (credential: CredentialForm) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  t: (key: any) => string;
}) {
  const requiresCredential = preset?.authType !== "none";
  return (
    <Dialog open={Boolean(preset)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {preset && (
          <form className="space-y-4" onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>{t("models.configureProviderTitle")} {preset.name}</DialogTitle>
              <DialogDescription>{t("models.configureProviderDescription")}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-sm">
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
              <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                {t("models.noCredentialRequired")}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isSaving}
                onClick={() => onOpenChange(false)}
              >
                {t("common.cancel")}
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
        )}
      </DialogContent>
    </Dialog>
  );
}

function adapterLabel(adapter: ProviderSupportedAdapter | ProviderApplyAdapter): string {
  if (adapter === "claude") return "Claude Code";
  if (adapter === "opencode") return "OpenCode";
  if (adapter === "openforge-copilot") return "OpenForge Copilot";
  if (adapter === "codex") return "Codex";
  return adapter;
}

function productTypeLabel(productType: string | null | undefined, t: (key: any) => string): string {
  if (productType === "coding_plan") return t("models.productTypeCodingPlan");
  if (productType === "token_plan") return t("models.productTypeTokenPlan");
  if (productType === "subscription") return t("models.productTypeSubscription");
  if (productType === "local") return t("models.productTypeLocal");
  return t("models.productTypePaygApi");
}

function ProviderHealthCard({
  readiness,
  isChecking,
  canCheck,
  onCheck,
  t,
}: {
  readiness: ModelProviderReadiness | null;
  isChecking: boolean;
  canCheck: boolean;
  onCheck: () => void;
  t: (key: any) => string;
}) {
  return (
    <Card data-testid="provider-health-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5" />
              {t("models.providerHealth")}
            </CardTitle>
            <CardDescription>{t("models.providerHealthDescription")}</CardDescription>
          </div>
          <Button type="button" variant="outline" disabled={!canCheck || isChecking} onClick={onCheck}>
            <RefreshCw className={`size-4 ${isChecking ? "animate-spin" : ""}`} />
            {t("models.checkReadiness")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!readiness ? (
          <EmptyLine text={t("models.providerHealthEmpty")} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={readiness.status === "ready" ? "default" : readiness.status === "managed_elsewhere" ? "secondary" : "outline"}>
                {readiness.status}
              </Badge>
              <Badge variant="outline">{readiness.code}</Badge>
              <span className="text-xs text-muted-foreground">{formatCheckedAt(readiness.checkedAt)}</span>
            </div>
            <div className="grid gap-2 text-sm">
              {readinessCheckEntries(readiness, t).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
                  <span className="text-muted-foreground">{label}</span>
                  <Badge variant={isReadyCheckValue(value) ? "default" : "outline"}>{value}</Badge>
                </div>
              ))}
            </div>
            {readiness.remote && (
              <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <div>{t("models.providerHealthRemoteChecked")}: {String(readiness.remote.checked)}</div>
                {readiness.remote.modelCount !== undefined && <div>{t("models.providerHealthRemoteModelCount")}: {readiness.remote.modelCount}</div>}
                {readiness.remote.matchedModelId && <div>{t("models.providerHealthMatchedModel")}: {readiness.remote.matchedModelId}</div>}
                {readiness.remote.errorCode && <div>{t("models.providerHealthErrorCode")}: {readiness.remote.errorCode}</div>}
                {readiness.remote.error && <div>{t("models.providerHealthError")}: {readiness.remote.error}</div>}
              </div>
            )}
            {readiness.steps.length > 0 && (
              <div className="space-y-2 rounded-md border bg-muted/20 px-3 py-2 text-sm">
                <div className="font-medium">{t("models.providerHealthNextSteps")}</div>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  {readiness.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CodexIdentityCard({ status, isLoading, t }: {
  status: CodexSubscriptionStatus | undefined;
  isLoading: boolean;
  t: (key: any) => string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5" />
          {t("models.codexSubscription")}
        </CardTitle>
        <CardDescription>{t("models.codexSubscriptionDescription")}</CardDescription>
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
            <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={status.sdk.docsUrl} target="_blank" rel="noreferrer">
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

function readinessCheckEntries(readiness: ModelProviderReadiness, t: (key: any) => string): Array<[string, string]> {
  return [
    [t("models.providerHealthCheckProvider"), readiness.checks.provider],
    [t("models.providerHealthCheckTarget"), readiness.checks.adapter],
    [t("models.providerHealthCheckModel"), readiness.checks.model],
    [t("models.providerHealthCheckCredential"), readiness.checks.credential],
    [t("models.providerHealthCheckRemoteModelList"), readiness.checks.remoteModelList],
  ];
}

function isReadyCheckValue(value: string): boolean {
  return value === "ready" || value === "supported" || value === "selected" || value === "passed" || value === "not_required";
}

function formatCheckedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function applyTargetsForProvider(provider: ProviderProfile | undefined): ProviderApplyAdapter[] {
  if (!provider) return [];
  const targets: ProviderApplyAdapter[] = [...provider.supportedAdapters];
  if (isCopilotCompatibleProfile(provider)) targets.push("openforge-copilot");
  return targets;
}

function buildApplyPayload(
  adapter: ProviderApplyAdapter,
  projectRoot: string,
  modelProfileId: string,
  credentialId: string
): { adapter: ProviderApplyAdapter; projectRoot?: string; modelProfileId?: string; credentialId?: string } {
  const root = projectRoot.trim();
  return {
    adapter,
    ...(adapter !== "openforge-copilot" && root ? { projectRoot: root } : {}),
    ...(modelProfileId ? { modelProfileId } : {}),
    ...(credentialId ? { credentialId } : {}),
  };
}

function isCopilotCompatibleProfile(provider: Pick<ProviderProfile, "apiFormat">): boolean {
  return isCopilotCompatibleProvider(provider);
}

function ProviderSummary({ provider, modelCount, credentialCount, isDeleting, onDelete, t }: {
  provider: ProviderProfile;
  modelCount: number;
  credentialCount: number;
  isDeleting: boolean;
  onDelete: () => void;
  t: (key: any) => string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{provider.name}</div>
          <div className="truncate text-xs text-muted-foreground">{provider.baseUrl ?? provider.providerKey}</div>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={isDeleting} onClick={onDelete}>
          <Trash2 className="size-4" />
          {t("common.delete")}
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCell label={t("models.providerKey")} value={provider.providerKey} />
        <SummaryCell label={t("models.apiFormat")} value={provider.apiFormat} />
        <SummaryCell label={t("models.region")} value={provider.region ?? "-"} />
        <SummaryCell label={t("models.productType")} value={productTypeLabel(provider.productType, t)} />
        <SummaryCell label={t("models.modelsWorkspace")} value={String(modelCount)} />
        <SummaryCell label={t("models.credentials")} value={String(credentialCount)} />
      </div>
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">{t("models.applyTargets")}</div>
        <div className="flex flex-wrap gap-2">
          {applyTargetsForProvider(provider).map((adapter) => (
            <Badge key={adapter} variant="outline">
              {adapterLabel(adapter)}
            </Badge>
          ))}
          <Badge variant="outline">{provider.authType}</Badge>
          {provider.anthropicBaseUrl && <Badge variant="outline">Anthropic: {provider.anthropicBaseUrl}</Badge>}
          {provider.openaiBaseUrl && <Badge variant="outline">OpenAI: {provider.openaiBaseUrl}</Badge>}
          {!provider.anthropicBaseUrl && !provider.openaiBaseUrl && provider.baseUrl && <Badge variant="outline">{provider.baseUrl}</Badge>}
        </div>
      </div>
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function CredentialTable({ credentials, selectedCredentialId, onSelectCredential, onDeleteCredential, isDeleting, t }: {
  credentials: ProviderCredentialSummary[];
  selectedCredentialId: string;
  onSelectCredential: (credentialId: string) => void;
  onDeleteCredential: (credentialId: string) => void;
  isDeleting: boolean;
  t: (key: any) => string;
}) {
  if (credentials.length === 0) return <EmptyLine text={t("models.emptyCredentials")} />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("common.name")}</TableHead>
          <TableHead>{t("models.apiKey")}</TableHead>
          <TableHead>{t("common.status")}</TableHead>
          <TableHead className="w-12" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {credentials.map((credential) => (
          <TableRow
            key={credential.id}
            className={credential.id === selectedCredentialId ? "bg-muted/50" : ""}
            onClick={() => onSelectCredential(credential.id)}
          >
            <TableCell className="font-medium">{credential.label ?? t("models.unnamedCredential")}</TableCell>
            <TableCell className="font-mono text-xs">{credential.secretPreview}</TableCell>
            <TableCell><Badge variant="outline">{credential.status}</Badge></TableCell>
            <TableCell>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8 text-muted-foreground hover:text-destructive"
                disabled={isDeleting}
                title={t("models.deleteCredential")}
                aria-label={t("models.deleteCredential")}
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteCredential(credential.id);
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ModelProfileTable({ models, selectedModelId, onSelectModel, onSetDefault, onDeleteModel, isSettingDefault, isDeleting, t }: {
  models: ModelProfile[];
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  onSetDefault: (modelId: string) => void;
  onDeleteModel: (modelId: string) => void;
  isSettingDefault: boolean;
  isDeleting: boolean;
  t: (key: any) => string;
}) {
  if (models.length === 0) return <EmptyLine text={t("models.emptyModelsForProvider")} />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("common.name")}</TableHead>
          <TableHead>{t("models.modelId")}</TableHead>
          <TableHead>{t("models.capabilities")}</TableHead>
          <TableHead className="w-24" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {models.map((model) => (
          <TableRow
            key={model.id}
            className={model.id === selectedModelId ? "bg-muted/50" : ""}
            onClick={() => onSelectModel(model.id)}
          >
            <TableCell className="font-medium">
              {model.name} {model.isDefault && <Badge className="ml-2">{t("models.default")}</Badge>}
            </TableCell>
            <TableCell className="font-mono text-xs">{model.modelId}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {model.capabilities.map((capability) => (
                  <Badge key={capability} variant="outline">{capability}</Badge>
                ))}
              </div>
            </TableCell>
            <TableCell>
              <div className="flex justify-end gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 text-muted-foreground hover:text-primary"
                  disabled={model.isDefault || isSettingDefault}
                  title={t("models.setDefault")}
                  aria-label={t("models.setDefault")}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSetDefault(model.id);
                  }}
                >
                  <ShieldCheck className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  disabled={isDeleting}
                  title={t("models.deleteModel")}
                  aria-label={t("models.deleteModel")}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteModel(model.id);
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ApplyColumn({
  provider,
  models,
  credentials,
  projectRoot,
  selectedModelId,
  selectedCredentialId,
  selectedAdapter,
  preview,
  isPreviewing,
  isApplying,
  onProjectRootChange,
  onModelChange,
  onCredentialChange,
  onAdapterChange,
  onPreview,
  onApply,
  t,
}: {
  provider: ProviderProfile | undefined;
  models: ModelProfile[];
  credentials: ProviderCredentialSummary[];
  projectRoot: string;
  selectedModelId: string;
  selectedCredentialId: string;
  selectedAdapter: ProviderApplyAdapter;
  preview: ProviderApplyPreview | null;
  isPreviewing: boolean;
  isApplying: boolean;
  onProjectRootChange: (projectRoot: string) => void;
  onModelChange: (modelId: string) => void;
  onCredentialChange: (credentialId: string) => void;
  onAdapterChange: (adapter: ProviderApplyAdapter) => void;
  onPreview: () => void;
  onApply: () => void;
  t: (key: any) => string;
}) {
  const supportedAdapters = applyTargetsForProvider(provider);
  const isCopilotTarget = selectedAdapter === "openforge-copilot";
  const previewBlockedReason = getApplyBlockedReason({
    provider,
    supportedAdapters,
    selectedAdapter,
    selectedModelId,
    projectRoot,
    needsPreview: false,
    preview,
    t,
  });
  const applyBlockedReason = getApplyBlockedReason({
    provider,
    supportedAdapters,
    selectedAdapter,
    selectedModelId,
    projectRoot,
    needsPreview: true,
    preview,
    t,
  });
  const previewDisabled = Boolean(previewBlockedReason);
  const applyDisabled = Boolean(applyBlockedReason);
  const selectedCredentialMissing = provider?.authType !== "none" && !selectedCredentialId;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="size-5" />
            {t("models.applyWorkspace")}
          </CardTitle>
          <CardDescription>{t("models.applyWorkspaceDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="apply-adapter">{t("models.applyScope")}</Label>
            <select
              id="apply-adapter"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={selectedAdapter}
              onChange={(event) => onAdapterChange(event.target.value as ProviderApplyAdapter)}
              disabled={!provider || supportedAdapters.length <= 1}
            >
              {supportedAdapters.map((adapter) => (
                <option key={adapter} value={adapter}>{adapterLabel(adapter)}</option>
              ))}
            </select>
          </div>
          {!isCopilotTarget ? (
            <div className="space-y-2">
              <Label htmlFor="apply-root">{t("models.projectPath")}</Label>
              <Input
                id="apply-root"
                value={projectRoot}
                onChange={(event) => onProjectRootChange(event.target.value)}
                placeholder="/path/to/project"
              />
            </div>
          ) : (
            <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              {t("models.copilotInternalApplyDescription")}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="apply-model">{t("projects.model")}</Label>
            <select
              id="apply-model"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={selectedModelId}
              onChange={(event) => onModelChange(event.target.value)}
              disabled={!provider || models.length === 0}
            >
              {models.length === 0 ? (
                <option value="">{t("models.noModelsAvailable")}</option>
              ) : (
                models.map((model) => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))
              )}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="apply-credential">{t("models.credentials")}</Label>
            <select
              id="apply-credential"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={selectedCredentialId}
              onChange={(event) => onCredentialChange(event.target.value)}
              disabled={!provider || provider.authType === "none"}
            >
              <option value="">{provider?.authType === "none" ? t("models.noCredentialRequired") : t("projects.hostEnvironment")}</option>
              {credentials.map((credential) => (
                <option key={credential.id} value={credential.id}>
                  {credential.label ?? t("models.unnamedCredential")}
                </option>
              ))}
            </select>
          </div>
          {(previewBlockedReason || applyBlockedReason || selectedCredentialMissing) && (
            <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              {previewBlockedReason ?? applyBlockedReason ?? t("models.hostCredentialHint")}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" disabled={previewDisabled || isPreviewing} onClick={onPreview}>
              <Braces className="size-4" />
              {t("models.previewApply")}
            </Button>
            <Button type="button" disabled={applyDisabled || isApplying} onClick={onApply}>
              <ShieldCheck className="size-4" />
              {t("models.applyConfig")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-5" />
            {t("models.applyPreview")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!preview ? (
            <EmptyLine text={t("models.noPreview")} />
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-1">
                {preview.changedFiles.map((file) => (
                  <Badge key={file.relativePath} variant="outline">
                    {file.operation}: {file.relativePath}
                  </Badge>
                ))}
              </div>
              <pre className="max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify({ env: preview.env, secretEnvNames: preview.secretEnvNames }, null, 2)}
              </pre>
              {preview.backupPath && (
                <div className="text-xs text-muted-foreground">{preview.backupPath}</div>
              )}
              {preview.internalDefault && (
                <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  {t("models.copilotDefaultPreview")}: {preview.internalDefault.providerName} / {preview.internalDefault.modelName}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function getApplyBlockedReason({
  provider,
  supportedAdapters,
  selectedAdapter,
  selectedModelId,
  projectRoot,
  needsPreview,
  preview,
  t,
}: {
  provider: ProviderProfile | undefined;
  supportedAdapters: ProviderApplyAdapter[];
  selectedAdapter: ProviderApplyAdapter;
  selectedModelId: string;
  projectRoot: string;
  needsPreview: boolean;
  preview: ProviderApplyPreview | null;
  t: (key: any) => string;
}): string | null {
  const isCopilotTarget = selectedAdapter === "openforge-copilot";
  if (!provider) return t("models.providerRequired");
  if (!supportedAdapters.includes(selectedAdapter)) return t("models.applyTargetUnsupported");
  if (!selectedModelId) return t("models.applyModelRequired");
  if (!isCopilotTarget && !projectRoot.trim()) return t("models.projectPathRequired");
  if (needsPreview && !preview) return t("models.previewRequiredBeforeApply");
  return null;
}

function EmptyLine({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{text}</div>;
}
