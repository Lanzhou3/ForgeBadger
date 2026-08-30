"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CheckCircle2,
  Cloud,
  Plus,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { AddProviderDialog } from "@/components/models/add-provider-dialog";
import { CodexIdentityCard } from "@/components/models/codex-identity-card";
import { DeleteConfirmDialog } from "@/components/models/delete-confirm-dialog";
import { ProviderList } from "@/components/models/provider-list";
import { ProviderWorkspace } from "@/components/models/provider-workspace";
import {
  applyTargetsForProvider,
  buildApplyPayload,
  emptyCredential,
  emptyCustomProvider,
  emptyModel,
  emptyModelReferences,
  type CredentialForm,
  type CustomProviderForm,
  type DeleteTarget,
  type ModelForm,
  type ModelReferenceInfo,
} from "@/components/models/shared";
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
  listSessions,
  previewProviderApply,
  rotateProviderCredential,
  setDefaultProviderModel,
  syncProviderModels,
  updateProviderModel,
  type ModelProviderReadiness,
  type ProviderApplyAdapter,
  type ProviderApplyPreview,
  type ProviderCatalogPreset,
} from "@/lib/api";
import {
  buildConfiguredProviderMap,
  filterProviderCatalog,
  type ProviderCatalogAdapterFilter,
  type ProviderCatalogConfiguredFilter,
  type ProviderCatalogSourceFilter,
} from "@/lib/model-provider-catalog";

export default function ModelsPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [customProvider, setCustomProvider] = useState<CustomProviderForm>(emptyCustomProvider);
  const [credentialForm, setCredentialForm] = useState<CredentialForm>(emptyCredential);
  const [modelForm, setModelForm] = useState<ModelForm>(emptyModel);
  const [projectRoot, setProjectRoot] = useState("");
  const [applyScope, setApplyScope] = useState<"project" | "user-global">("project");
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
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [rotateDialogOpen, setRotateDialogOpen] = useState(false);

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
  // 引用检测：会话与代理选择模型后会产生外键引用，删除前需先切换模型。
  const sessionsQuery = useQuery({
    queryKey: ["model-page-sessions"],
    queryFn: listSessions,
    staleTime: 30_000,
  });
  const providers = providerQuery.data?.providers ?? [];
  const models = providerQuery.data?.models ?? [];
  const credentials = providerQuery.data?.credentials ?? [];
  const catalog = catalogQuery.data?.providers ?? [];
  // model_profiles id 与 legacy models id 相同（mirrorLegacy），会话/代理的
  // modelId 直接按模型 profile id 匹配即可。
  const modelReferences = useMemo(() => {
    const map = new Map<string, ModelReferenceInfo>();
    for (const model of models) map.set(model.id, { sessions: [] });
    for (const session of sessionsQuery.data?.sessions ?? []) {
      if (!session.modelId) continue;
      const info = map.get(session.modelId);
      if (info) {
        info.sessions.push({
          id: session.id,
          name: session.name ?? session.tmuxName ?? session.id,
          status: session.status,
        });
      }
    }
    return map;
  }, [models, sessionsQuery.data]);
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
  const modelCountsByProvider = useMemo(() => {
    const counts = new Map<string, number>();
    for (const model of models) {
      counts.set(model.providerProfileId, (counts.get(model.providerProfileId) ?? 0) + 1);
    }
    return counts;
  }, [models]);
  const deleteTargetReferences = useMemo<ModelReferenceInfo>(() => {
    if (!deleteTarget) return emptyModelReferences;
    if (deleteTarget.kind === "model") {
      return modelReferences.get(deleteTarget.modelId) ?? emptyModelReferences;
    }
    if (deleteTarget.kind === "credential") return emptyModelReferences;
    const targetModels = models.filter((model) => model.providerProfileId === deleteTarget.providerId);
    const sessions: Array<{ id: string; name: string; status: string }> = [];
    const seenSessions = new Set<string>();
    for (const model of targetModels) {
      const refs = modelReferences.get(model.id);
      if (!refs) continue;
      for (const ref of refs.sessions) {
        if (!seenSessions.has(ref.id)) {
          seenSessions.add(ref.id);
          sessions.push(ref);
        }
      }
    }
    return { sessions };
  }, [deleteTarget, models, modelReferences]);

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
      setAddProviderOpen(false);
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
      setAddProviderOpen(false);
      setNotice(t("models.providerCreated"));
      await refreshProviders();
    },
  });

  const deleteProviderMutation = useMutation({
    mutationFn: (providerId: string) => deleteModelProvider(providerId),
    onSuccess: async (_result, providerId) => {
      setDeleteTarget(null);
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
      setRotateDialogOpen(false);
      setNotice(t("models.credentialRotated"));
      await refreshProviders();
    },
  });

  const deleteCredentialMutation = useMutation({
    mutationFn: (credentialId: string) => deleteProviderCredential(selectedProviderId, credentialId),
    onSuccess: async (_result, credentialId) => {
      setDeleteTarget(null);
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
      setModelDialogOpen(false);
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
      setModelDialogOpen(false);
      setNotice(t("models.updated"));
      await refreshProviders();
    },
  });

  const deleteModelMutation = useMutation({
    mutationFn: (modelId: string) => deleteProviderModel(selectedProviderId, modelId),
    onSuccess: async (_result, modelId) => {
      setDeleteTarget(null);
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

  function openDeleteDialog(target: DeleteTarget) {
    setDeleteTarget(target);
  }

  function handleConfirmDelete() {
    if (!deleteTarget) return;
    if (deleteTarget.kind === "provider") {
      deleteProviderMutation.mutate(deleteTarget.providerId);
    } else if (deleteTarget.kind === "model") {
      deleteModelMutation.mutate(deleteTarget.modelId);
    } else {
      deleteCredentialMutation.mutate(deleteTarget.credentialId);
    }
  }

  const anyDeletePending =
    deleteProviderMutation.isPending ||
    deleteModelMutation.isPending ||
    deleteCredentialMutation.isPending;

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
        buildApplyPayload(selectedApplyAdapter, applyScope, projectRoot, selectedModelId, selectedCredentialId)
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
        buildApplyPayload(selectedApplyAdapter, applyScope, projectRoot, selectedModelId, selectedCredentialId)
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

  function openAddProviderDialog() {
    setPendingPreset(null);
    setSetupCredentialForm(emptyCredential);
    setAddProviderOpen(true);
  }

  function handleAddProviderOpenChange(open: boolean) {
    if (!open && addPresetMutation.isPending) return;
    if (!open) {
      setPendingPreset(null);
      setSetupCredentialForm(emptyCredential);
    }
    setAddProviderOpen(open);
  }

  function openNewModelDialog() {
    setSelectedModelId("");
    setModelForm(emptyModel);
    setModelDialogOpen(true);
  }

  function openEditModelDialog(modelId: string) {
    setSelectedModelId(modelId);
    setModelDialogOpen(true);
  }

  function openRotateDialog(credentialId: string) {
    setSelectedCredentialId(credentialId);
    setCredentialForm((form) => ({ ...form, plaintextSecret: "" }));
    setRotateDialogOpen(true);
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
    <div className="mx-auto max-w-[1400px] space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 forgebadger-animate-in">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("models.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("models.providerCenterSubtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/cli-config">
              {t("models.viewGlobalCliConfig")}
              <ArrowUpRight className="size-4" />
            </Link>
          </Button>
          <Button
            type="button"
            size="sm"
            className="bg-brand text-brand-foreground hover:bg-brand/90"
            onClick={openAddProviderDialog}
          >
            <Plus className="size-4" />
            {t("models.addProvider")}
          </Button>
        </div>
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{notice}</span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-6 shrink-0 text-current"
            aria-label={t("common.close")}
            onClick={() => setNotice(null)}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}

      {currentError instanceof Error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1">{currentError.message}</span>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <ProviderList
            providers={filteredProviders}
            providerCount={providers.length}
            modelCounts={modelCountsByProvider}
            queryText={providerQueryText}
            selectedProviderId={selectedProviderId}
            isLoading={providerQuery.isLoading || catalogQuery.isLoading}
            isDeleting={deleteProviderMutation.isPending}
            onQueryTextChange={setProviderQueryText}
            onSelectProvider={setSelectedProviderId}
            onDeleteProvider={(providerId) => openDeleteDialog({ kind: "provider", providerId })}
            t={t}
          />
          <CodexIdentityCard
            status={codexSubscriptionQuery.data?.status}
            isLoading={codexSubscriptionQuery.isLoading}
            t={t}
          />
        </div>

        <div className="min-w-0">
          {selectedProvider ? (
            <ProviderWorkspace
              provider={selectedProvider}
              readiness={providerReadiness}
              isCheckingReadiness={readinessMutation.isPending}
              isSyncing={syncModelsMutation.isPending}
              syncDisabled={
                selectedProvider.authType !== "none" && !selectedCredentialId
              }
              isDeletingProvider={deleteProviderMutation.isPending}
              onCheckReadiness={() => readinessMutation.mutate()}
              onSync={() => syncModelsMutation.mutate()}
              onDeleteProvider={() => openDeleteDialog({ kind: "provider", providerId: selectedProvider.id })}
              modelsTab={{
                models: providerModels,
                references: modelReferences,
                selectedModelId,
                modelForm,
                dialogOpen: modelDialogOpen,
                isSaving: modelMutation.isPending || updateModelMutation.isPending,
                isSettingDefault: setDefaultModelMutation.isPending,
                isDeleting: deleteModelMutation.isPending,
                onModelFormChange: setModelForm,
                onDialogOpenChange: setModelDialogOpen,
                onNewModel: openNewModelDialog,
                onEditModel: openEditModelDialog,
                onSetDefault: (modelId) => setDefaultModelMutation.mutate(modelId),
                onDeleteModel: (modelId) => openDeleteDialog({ kind: "model", modelId }),
                onSubmitModel: submitModel,
              }}
              credentialTab={{
                credentials: providerCredentials,
                selectedCredentialId,
                credentialForm,
                rotateDialogOpen,
                isSaving: credentialMutation.isPending,
                isRotating: rotateCredentialMutation.isPending,
                isDeleting: deleteCredentialMutation.isPending,
                onCredentialFormChange: setCredentialForm,
                onRotateDialogOpenChange: setRotateDialogOpen,
                onSelectCredential: setSelectedCredentialId,
                onSubmitCredential: submitCredential,
                onOpenRotate: openRotateDialog,
                onConfirmRotate: () => rotateCredentialMutation.mutate(),
                onDeleteCredential: (credentialId) => openDeleteDialog({ kind: "credential", credentialId }),
              }}
              applyTab={{
                provider: selectedProvider,
                models: providerModels,
                credentials: providerCredentials,
                projectRoot,
                applyScope,
                selectedModelId,
                selectedCredentialId,
                selectedAdapter: selectedApplyAdapter,
                preview: applyPreview,
                isPreviewing: previewMutation.isPending,
                isApplying: applyMutation.isPending,
                onProjectRootChange: setProjectRoot,
                onScopeChange: setApplyScope,
                onModelChange: setSelectedModelId,
                onCredentialChange: setSelectedCredentialId,
                onAdapterChange: setSelectedApplyAdapter,
                onPreview: () => previewMutation.mutate(),
                onApply: () => applyMutation.mutate(),
              }}
              t={t}
            />
          ) : (
            <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border/70 bg-card/50 px-6 py-12 text-center forgebadger-animate-in">
              <div className="flex size-10 items-center justify-center rounded-md bg-brand/10 text-brand">
                <Cloud className="size-5" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">{t("models.emptyWorkspaceTitle")}</div>
                <p className="max-w-md text-sm text-muted-foreground">{t("models.emptyProviders")}</p>
              </div>
              <Button
                type="button"
                size="sm"
                className="bg-brand text-brand-foreground hover:bg-brand/90"
                onClick={openAddProviderDialog}
              >
                <Plus className="size-4" />
                {t("models.addProvider")}
              </Button>
            </div>
          )}
        </div>
      </div>

      <AddProviderDialog
        open={addProviderOpen}
        pendingPreset={pendingPreset}
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
        customProvider={customProvider}
        isCreatingCustom={customProviderMutation.isPending}
        setupCredential={setupCredentialForm}
        onOpenChange={handleAddProviderOpenChange}
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
        onSelectProvider={(providerId) => {
          setSelectedProviderId(providerId);
          setAddProviderOpen(false);
        }}
        onCustomProviderChange={setCustomProvider}
        onSubmitCustomProvider={submitCustomProvider}
        onSetupCredentialChange={setSetupCredentialForm}
        onSubmitSetup={submitPresetSetup}
        onBackToCatalog={() => setPendingPreset(null)}
        t={t}
      />
      <DeleteConfirmDialog
        target={deleteTarget}
        references={deleteTargetReferences}
        isDeleting={anyDeletePending}
        onOpenChange={(open) => {
          if (!open && !anyDeletePending) {
            setDeleteTarget(null);
          }
        }}
        onConfirm={handleConfirmDelete}
        t={t}
      />
    </div>
  );
}
