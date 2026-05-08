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
  ServerCog,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  createModelProvider,
  createProviderCredential,
  createProviderModel,
  deleteModelProvider,
  getCodexSubscriptionStatus,
  listModelProviders,
  listProviderCatalog,
  previewProviderApply,
  type ModelProfile,
  type ProviderApplyAdapter,
  type ProviderApplyPreview,
  type ProviderCatalogPreset,
  type ProviderCredentialSummary,
  type ProviderProfile,
} from "@/lib/api";

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
  const [applyAdapter, setApplyAdapter] = useState<ProviderApplyAdapter>("claude");
  const [projectRoot, setProjectRoot] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedCredentialId, setSelectedCredentialId] = useState("");
  const [applyPreview, setApplyPreview] = useState<ProviderApplyPreview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const providerQuery = useQuery({
    queryKey: ["model-providers"],
    queryFn: listModelProviders,
  });
  const catalogQuery = useQuery({
    queryKey: ["model-provider-catalog"],
    queryFn: listProviderCatalog,
  });
  const codexStatusQuery = useQuery({
    queryKey: ["codex-subscription-status"],
    queryFn: getCodexSubscriptionStatus,
  });

  const providers = providerQuery.data?.providers ?? [];
  const models = providerQuery.data?.models ?? [];
  const credentials = providerQuery.data?.credentials ?? [];
  const catalog = catalogQuery.data?.providers ?? [];

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

  useEffect(() => {
    setSelectedModelId((current) =>
      providerModels.some((model) => model.id === current) ? current : providerModels[0]?.id || ""
    );
    setSelectedCredentialId((current) =>
      providerCredentials.some((credential) => credential.id === current) ? current : providerCredentials[0]?.id || ""
    );
    setApplyPreview(null);
  }, [providerModels, providerCredentials]);

  const addPresetMutation = useMutation({
    mutationFn: (catalogId: string) => createModelProvider({ catalogId }),
    onSuccess: async (result) => {
      setSelectedProviderId(result.provider.id);
      setNotice(t("models.providerCreated"));
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
        apiFormat: "openai-compatible",
        supportedAdapters: ["opencode"],
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

  const previewMutation = useMutation({
    mutationFn: () => {
      if (!selectedProviderId) throw new Error(t("models.providerRequired"));
      return previewProviderApply(selectedProviderId, {
        adapter: applyAdapter,
        projectRoot: projectRoot.trim(),
        modelProfileId: selectedModelId || undefined,
        credentialId: selectedCredentialId || undefined,
      });
    },
    onSuccess: (result) => {
      setApplyPreview(result.preview);
      setNotice(t("models.previewReady"));
    },
  });

  const applyMutation = useMutation({
    mutationFn: () => {
      if (!selectedProviderId) throw new Error(t("models.providerRequired"));
      return applyProviderConfig(selectedProviderId, {
        adapter: applyAdapter,
        projectRoot: projectRoot.trim(),
        modelProfileId: selectedModelId || undefined,
        credentialId: selectedCredentialId || undefined,
      });
    },
    onSuccess: (result) => {
      setApplyPreview(result.result);
      setNotice(t("models.applyComplete"));
    },
  });

  function refreshProviders() {
    setApplyPreview(null);
    return queryClient.invalidateQueries({ queryKey: ["model-providers"] });
  }

  function submitCustomProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    customProviderMutation.mutate();
  }

  function submitCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    credentialMutation.mutate();
  }

  function submitModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    modelMutation.mutate();
  }

  const currentError =
    providerQuery.error ??
    catalogQuery.error ??
    codexStatusQuery.error ??
    addPresetMutation.error ??
    customProviderMutation.error ??
    deleteProviderMutation.error ??
    credentialMutation.error ??
    modelMutation.error ??
    previewMutation.error ??
    applyMutation.error;
  const codexStatus = codexStatusQuery.data?.status;

  return (
    <div className="space-y-5 p-6">
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

      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
        <ProviderColumn
          catalog={catalog}
          providers={providers}
          selectedProviderId={selectedProviderId}
          isLoading={providerQuery.isLoading || catalogQuery.isLoading}
          isAdding={addPresetMutation.isPending}
          onSelectProvider={setSelectedProviderId}
          onAddPreset={(preset) => addPresetMutation.mutate(preset.id)}
          t={t}
        />

        <div className="space-y-4">
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
              <form className="mt-4 grid gap-3 md:grid-cols-3" onSubmit={submitCustomProvider}>
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
              <form className="grid gap-3 md:grid-cols-[1fr_1fr_auto]" onSubmit={submitCredential}>
                <Input
                  placeholder={t("models.credentialLabel")}
                  value={credentialForm.label}
                  onChange={(event) => setCredentialForm((form) => ({ ...form, label: event.target.value }))}
                  disabled={!selectedProvider}
                />
                <Input
                  type="password"
                  placeholder={t("models.apiKey")}
                  value={credentialForm.plaintextSecret}
                  onChange={(event) => setCredentialForm((form) => ({ ...form, plaintextSecret: event.target.value }))}
                  disabled={!selectedProvider}
                  required
                />
                <Button type="submit" disabled={!selectedProvider || credentialMutation.isPending}>
                  <Plus className="size-4" />
                  {t("models.saveCredential")}
                </Button>
              </form>
              <CredentialTable
                credentials={providerCredentials}
                selectedCredentialId={selectedCredentialId}
                onSelectCredential={setSelectedCredentialId}
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
              <form className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={submitModel}>
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
                <Button type="submit" disabled={!selectedProvider || modelMutation.isPending}>
                  <Plus className="size-4" />
                  {t("models.addModel")}
                </Button>
              </form>
              <ModelProfileTable
                models={providerModels}
                selectedModelId={selectedModelId}
                onSelectModel={setSelectedModelId}
                t={t}
              />
            </CardContent>
          </Card>
        </div>

        <ApplyColumn
          provider={selectedProvider}
          models={providerModels}
          credentials={providerCredentials}
          adapter={applyAdapter}
          projectRoot={projectRoot}
          selectedModelId={selectedModelId}
          selectedCredentialId={selectedCredentialId}
          preview={applyPreview}
          codexStatus={codexStatus}
          isPreviewing={previewMutation.isPending}
          isApplying={applyMutation.isPending}
          onAdapterChange={(adapter) => {
            setApplyAdapter(adapter);
            setApplyPreview(null);
          }}
          onProjectRootChange={setProjectRoot}
          onModelChange={setSelectedModelId}
          onCredentialChange={setSelectedCredentialId}
          onPreview={() => previewMutation.mutate()}
          onApply={() => applyMutation.mutate()}
          t={t}
        />
      </div>
    </div>
  );
}

interface ProviderColumnProps {
  catalog: ProviderCatalogPreset[];
  providers: ProviderProfile[];
  selectedProviderId: string;
  isLoading: boolean;
  isAdding: boolean;
  onSelectProvider: (providerId: string) => void;
  onAddPreset: (preset: ProviderCatalogPreset) => void;
  t: (key: any) => string;
}

function ProviderColumn({ catalog, providers, selectedProviderId, isLoading, isAdding, onSelectProvider, onAddPreset, t }: ProviderColumnProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="size-5" />
            {t("models.providers")}
          </CardTitle>
          <CardDescription>{t("models.providersDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <EmptyLine text={t("common.loading")} />
          ) : providers.length === 0 ? (
            <EmptyLine text={t("models.emptyProviders")} />
          ) : (
            providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                  provider.id === selectedProviderId
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted"
                }`}
                onClick={() => onSelectProvider(provider.id)}
              >
                <span className="block font-medium">{provider.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{provider.baseUrl ?? provider.providerKey}</span>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("models.providerCatalog")}</CardTitle>
          <CardDescription>{t("models.providerCatalogDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {catalog.map((preset) => (
            <div key={preset.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{preset.name}</div>
                  <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{preset.description}</div>
                </div>
                <Button size="sm" variant="outline" disabled={isAdding} onClick={() => onAddPreset(preset)}>
                  <Plus className="size-4" />
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                <Badge variant="outline">{preset.apiFormat}</Badge>
                <Badge variant="outline">{preset.authType}</Badge>
                <Badge variant="secondary">
                  {preset.defaultModels.length} {t("models.modelsWorkspace")}
                </Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
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
        <SummaryCell label={t("models.modelsWorkspace")} value={String(modelCount)} />
        <SummaryCell label={t("models.credentials")} value={String(credentialCount)} />
      </div>
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">{t("models.applyTargets")}</div>
        <div className="flex flex-wrap gap-2">
          {provider.supportedAdapters.map((adapter) => (
            <Badge key={adapter} variant="secondary">{adapter === "claude" ? "Claude Code" : "OpenCode"}</Badge>
          ))}
          <Badge variant="outline">{provider.authType}</Badge>
          {provider.baseUrl && <Badge variant="outline">{provider.baseUrl}</Badge>}
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

function CredentialTable({ credentials, selectedCredentialId, onSelectCredential, t }: {
  credentials: ProviderCredentialSummary[];
  selectedCredentialId: string;
  onSelectCredential: (credentialId: string) => void;
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
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ModelProfileTable({ models, selectedModelId, onSelectModel, t }: {
  models: ModelProfile[];
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
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
  adapter,
  projectRoot,
  selectedModelId,
  selectedCredentialId,
  preview,
  codexStatus,
  isPreviewing,
  isApplying,
  onAdapterChange,
  onProjectRootChange,
  onModelChange,
  onCredentialChange,
  onPreview,
  onApply,
  t,
}: {
  provider: ProviderProfile | undefined;
  models: ModelProfile[];
  credentials: ProviderCredentialSummary[];
  adapter: ProviderApplyAdapter;
  projectRoot: string;
  selectedModelId: string;
  selectedCredentialId: string;
  preview: ProviderApplyPreview | null;
  codexStatus: {
    connectionState: string;
    canUseAppServerIdentity: boolean;
    sdk?: {
      packageName: string;
      installed: boolean;
      docsUrl: string;
      appServerDocsUrl: string;
    };
  } | undefined;
  isPreviewing: boolean;
  isApplying: boolean;
  onAdapterChange: (adapter: ProviderApplyAdapter) => void;
  onProjectRootChange: (projectRoot: string) => void;
  onModelChange: (modelId: string) => void;
  onCredentialChange: (credentialId: string) => void;
  onPreview: () => void;
  onApply: () => void;
  t: (key: any) => string;
}) {
  const isCodex = adapter === "codex";
  const applyDisabled = !provider || !projectRoot.trim() || !selectedModelId || isCodex;
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
            <Label htmlFor="apply-adapter">{t("common.aiTool")}</Label>
            <select
              id="apply-adapter"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={adapter}
              onChange={(event) => onAdapterChange(event.target.value as ProviderApplyAdapter)}
            >
              <option value="claude">Claude Code</option>
              <option value="opencode">OpenCode</option>
              <option value="codex">Codex</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="apply-root">{t("common.path")}</Label>
            <Input
              id="apply-root"
              value={projectRoot}
              onChange={(event) => onProjectRootChange(event.target.value)}
              placeholder="/path/to/project"
              disabled={isCodex}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="apply-model">{t("projects.model")}</Label>
            <select
              id="apply-model"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={selectedModelId}
              onChange={(event) => onModelChange(event.target.value)}
              disabled={isCodex}
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="apply-credential">{t("models.credentials")}</Label>
            <select
              id="apply-credential"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={selectedCredentialId}
              onChange={(event) => onCredentialChange(event.target.value)}
              disabled={isCodex}
            >
              <option value="">{t("projects.hostEnvironment")}</option>
              {credentials.map((credential) => (
                <option key={credential.id} value={credential.id}>
                  {credential.label ?? t("models.unnamedCredential")}
                </option>
              ))}
            </select>
          </div>
          {isCodex && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <div className="font-medium">{t("models.codexSubscription")}</div>
              <div className="mt-1 text-muted-foreground">
                {t("models.codexSubscriptionDescription")}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">
                  {codexStatus?.connectionState ?? "not_connected"}
                </Badge>
                <Badge variant={codexStatus?.sdk?.installed ? "secondary" : "outline"}>
                  {codexStatus?.sdk?.packageName ?? "@openai/codex-sdk"}
                  {codexStatus?.sdk?.installed ? ` ${t("models.sdkInstalled")}` : ` ${t("models.sdkMissing")}`}
                </Badge>
              </div>
              <a
                className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                href={codexStatus?.sdk?.docsUrl ?? "https://developers.openai.com/codex/sdk"}
                target="_blank"
                rel="noreferrer"
              >
                {t("models.codexOfficialDocs")}
                <ExternalLink className="size-3" />
              </a>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" disabled={applyDisabled || isPreviewing} onClick={onPreview}>
              <Braces className="size-4" />
              {t("models.previewApply")}
            </Button>
            <Button type="button" disabled={applyDisabled || isApplying || !preview} onClick={onApply}>
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{text}</div>;
}
