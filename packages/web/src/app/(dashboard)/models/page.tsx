"use client";

import { type FormEvent, type ReactNode, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Brain,
  CheckCircle2,
  Globe,
  KeyRound,
  Pencil,
  Plus,
  RotateCw,
  Save,
  Star,
  Trash2,
  X,
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
  checkModelEndpointHealth,
  checkModelHealth,
  createApiKey,
  createModel,
  deleteApiKey,
  deleteModel,
  listApiKeys,
  listModelGroups,
  listModelPresets,
  listModels,
  rotateApiKey,
  setDefaultModel,
  updateModel,
  type ApiKeySummary,
  type Model,
  type ModelEndpointHealth,
  type ModelHealth,
  type ModelPreset,
} from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";

interface ModelFormState {
  name: string;
  provider: string;
  modelId: string;
  endpoint: string;
}

interface ApiKeyFormState {
  name: string;
  provider: string;
  plaintextKey: string;
}

const emptyModelForm: ModelFormState = {
  name: "",
  provider: "anthropic",
  modelId: "",
  endpoint: "",
};

const emptyApiKeyForm: ApiKeyFormState = {
  name: "",
  provider: "anthropic",
  plaintextKey: "",
};

export default function ModelsPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [modelForm, setModelForm] = useState<ModelFormState>(emptyModelForm);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [apiKeyForm, setApiKeyForm] = useState<ApiKeyFormState>(emptyApiKeyForm);
  const [rotatingKeyId, setRotatingKeyId] = useState<string | null>(null);
  const [rotationValue, setRotationValue] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [modelHealthById, setModelHealthById] = useState<Record<string, ModelHealth>>({});
  const [endpointHealthById, setEndpointHealthById] = useState<Record<string, ModelEndpointHealth>>({});

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["models"],
    queryFn: listModels,
  });

  const {
    data: apiKeyData,
    isLoading: apiKeysLoading,
    isError: apiKeysError,
    error: apiKeysErrorValue,
  } = useQuery({
    queryKey: ["api-keys"],
    queryFn: listApiKeys,
  });

  const { data: presetData } = useQuery({
    queryKey: ["model-presets"],
    queryFn: listModelPresets,
  });

  const { data: groupData } = useQuery({
    queryKey: ["model-groups"],
    queryFn: listModelGroups,
  });

  const models = data?.models ?? [];
  const modelGroups = groupData?.groups ?? [];
  const modelPresets = presetData?.presets ?? [];
  const apiKeys = apiKeyData?.apiKeys ?? [];

  const modelMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: modelForm.name.trim(),
        provider: modelForm.provider.trim(),
        modelId: modelForm.modelId.trim(),
        ...(modelForm.endpoint.trim() ? { endpoint: modelForm.endpoint.trim() } : {}),
      };
      return editingModelId ? updateModel(editingModelId, payload) : createModel(payload);
    },
    onSuccess: async () => {
      setNotice(editingModelId ? t("models.updated") : t("models.created"));
      setModelForm(emptyModelForm);
      setEditingModelId(null);
      await queryClient.invalidateQueries({ queryKey: ["models"] });
      await queryClient.invalidateQueries({ queryKey: ["model-groups"] });
    },
  });

  const defaultModelMutation = useMutation({
    mutationFn: setDefaultModel,
    onSuccess: async () => {
      setNotice(t("models.defaultUpdated"));
      await queryClient.invalidateQueries({ queryKey: ["models"] });
      await queryClient.invalidateQueries({ queryKey: ["model-groups"] });
    },
  });

  const modelHealthMutation = useMutation({
    mutationFn: checkModelHealth,
    onSuccess: (result, modelId) => {
      setModelHealthById((current) => ({ ...current, [modelId]: result.health }));
      setNotice(
        result.health.healthy
          ? t("models.healthReadyDescription")
          : t("models.healthNeedsAttentionDescription")
      );
    },
  });

  const endpointHealthMutation = useMutation({
    mutationFn: (modelId: string) => checkModelEndpointHealth(modelId),
    onSuccess: (result, modelId) => {
      setEndpointHealthById((current) => ({ ...current, [modelId]: result.health }));
      setNotice(
        result.health.healthy
          ? `${t("models.endpointHealthy")} · ${result.health.latencyMs}ms`
          : result.health.error ?? t("models.endpointFailed")
      );
    },
  });

  const deleteModelMutation = useMutation({
    mutationFn: deleteModel,
    onSuccess: async () => {
      setNotice(t("models.deleted"));
      await queryClient.invalidateQueries({ queryKey: ["models"] });
      await queryClient.invalidateQueries({ queryKey: ["model-groups"] });
    },
  });

  const apiKeyMutation = useMutation({
    mutationFn: () =>
      createApiKey({
        name: apiKeyForm.name.trim(),
        provider: apiKeyForm.provider.trim(),
        plaintextKey: apiKeyForm.plaintextKey,
      }),
    onSuccess: async () => {
      setNotice(t("models.apiKeyCreated"));
      setApiKeyForm(emptyApiKeyForm);
      await queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  const rotateMutation = useMutation({
    mutationFn: (apiKeyId: string) => rotateApiKey(apiKeyId, rotationValue),
    onSuccess: async () => {
      setNotice(t("models.apiKeyRotated"));
      setRotatingKeyId(null);
      setRotationValue("");
      await queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  const deleteApiKeyMutation = useMutation({
    mutationFn: deleteApiKey,
    onSuccess: async () => {
      setNotice(t("models.apiKeyDeleted"));
      await queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  function submitModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    modelMutation.mutate();
  }

  function submitApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    apiKeyMutation.mutate();
  }

  function editModel(model: Model) {
    setEditingModelId(model.id);
    setModelForm({
      name: model.name,
      provider: model.provider,
      modelId: model.modelId,
      endpoint: model.endpoint ?? "",
    });
    setNotice(null);
  }

  function cancelModelEdit() {
    setEditingModelId(null);
    setModelForm(emptyModelForm);
  }

  function applyPreset(preset: ModelPreset) {
    setEditingModelId(null);
    setModelForm({
      name: preset.label,
      provider: preset.provider,
      modelId: preset.modelId,
      endpoint: preset.endpoint,
    });
    setNotice(null);
  }

  const currentError =
    modelMutation.error ??
    defaultModelMutation.error ??
    modelHealthMutation.error ??
    endpointHealthMutation.error ??
    deleteModelMutation.error ??
    apiKeyMutation.error ??
    rotateMutation.error ??
    deleteApiKeyMutation.error ??
    error ??
    apiKeysErrorValue;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("models.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("models.subtitle")}</p>
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="size-5" />
              {t("models.catalog")}
            </CardTitle>
            <CardDescription>{t("models.catalogDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={submitModel}>
              <div className="space-y-2">
                <Label htmlFor="model-name">{t("common.name")}</Label>
                <Input
                  id="model-name"
                  value={modelForm.name}
                  onChange={(event) => setModelForm((form) => ({ ...form, name: event.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model-provider">{t("models.provider")}</Label>
                <Input
                  id="model-provider"
                  value={modelForm.provider}
                  onChange={(event) => setModelForm((form) => ({ ...form, provider: event.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model-id">{t("models.modelId")}</Label>
                <Input
                  id="model-id"
                  value={modelForm.modelId}
                  onChange={(event) => setModelForm((form) => ({ ...form, modelId: event.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model-endpoint">{t("models.endpoint")}</Label>
                <Input
                  id="model-endpoint"
                  value={modelForm.endpoint}
                  onChange={(event) => setModelForm((form) => ({ ...form, endpoint: event.target.value }))}
                />
              </div>
              <div className="flex gap-2 md:col-span-2 xl:col-span-4">
                <Button type="submit" disabled={modelMutation.isPending}>
                  {editingModelId ? <Save className="size-4" /> : <Plus className="size-4" />}
                  {modelMutation.isPending
                    ? t("models.saving")
                    : editingModelId
                      ? t("models.saveModel")
                      : t("models.addModel")}
                </Button>
                {editingModelId && (
                  <Button type="button" variant="outline" onClick={cancelModelEdit}>
                    <X className="size-4" />
                    {t("common.cancel")}
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("models.presets")}</CardTitle>
            <CardDescription>{t("models.presetsDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {modelPresets.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                variant="outline"
                className="h-auto justify-start py-2 text-left"
                onClick={() => applyPreset(preset)}
              >
                <span>
                  <span className="block font-medium">{preset.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {preset.provider} · {preset.tier}
                  </span>
                </span>
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-5" />
              {t("models.apiKeys")}
            </CardTitle>
            <CardDescription>{t("models.apiKeysDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={submitApiKey}>
              <div className="space-y-2">
                <Label htmlFor="api-key-name">{t("common.name")}</Label>
                <Input
                  id="api-key-name"
                  value={apiKeyForm.name}
                  onChange={(event) => setApiKeyForm((form) => ({ ...form, name: event.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="api-key-provider">{t("models.provider")}</Label>
                <Input
                  id="api-key-provider"
                  value={apiKeyForm.provider}
                  onChange={(event) => setApiKeyForm((form) => ({ ...form, provider: event.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="api-key-value">{t("models.apiKey")}</Label>
                <Input
                  id="api-key-value"
                  type="password"
                  value={apiKeyForm.plaintextKey}
                  onChange={(event) => setApiKeyForm((form) => ({ ...form, plaintextKey: event.target.value }))}
                  required
                />
              </div>
              <Button className="sm:col-span-2" type="submit" disabled={apiKeyMutation.isPending}>
                <Plus className="size-4" />
                {apiKeyMutation.isPending ? t("models.saving") : t("models.addApiKey")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("models.configuredModels")}</CardTitle>
          <CardDescription>{t("models.configuredModelsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t("models.loading")}</div>
          ) : isError ? (
            <div className="py-8 text-center text-sm text-destructive">{t("models.failedLoad")}</div>
          ) : models.length === 0 ? (
            <EmptyState
              icon={<Brain className="size-10 text-muted-foreground" />}
              title={t("models.emptyTitle")}
              description={t("models.emptyDescription")}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("models.provider")}</TableHead>
                  <TableHead>{t("models.modelId")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(modelGroups.length > 0
                  ? modelGroups.flatMap((group) => group.models.map((model) => ({ model, group })))
                  : models.map((model) => ({ model, group: { provider: model.provider, count: 1 } }))
                ).map(({ model, group }) => {
                  const health = modelHealthById[model.id];
                  const endpointHealth = endpointHealthById[model.id];
                  return (
                    <TableRow key={model.id}>
                      <TableCell className="font-medium">
                        <div className="flex flex-col gap-1">
                          <span>{model.name}</span>
                          {model.endpoint && (
                            <span className="text-xs text-muted-foreground">{model.endpoint}</span>
                          )}
                          {health && (
                            <span className={health.healthy ? "text-xs text-emerald-600 dark:text-emerald-300" : "text-xs text-destructive"}>
                              {health.healthy
                                ? t("models.healthReadyDescription")
                                : t("models.healthNeedsAttentionDescription")}
                            </span>
                          )}
                          {endpointHealth && (
                            <span className={endpointHealth.healthy ? "text-xs text-emerald-600 dark:text-emerald-300" : "text-xs text-destructive"}>
                              {endpointHealth.healthy
                                ? `${t("models.endpointHealthy")} · ${endpointHealth.latencyMs}ms`
                                : endpointHealth.error ?? t("models.endpointFailed")}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span>{model.provider}</span>
                          <span className="text-xs text-muted-foreground">
                            {t("models.providerGroup")}: {group.provider} ({group.count})
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{model.modelId}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {model.isDefault ? (
                            <Badge variant="default">{t("models.default")}</Badge>
                          ) : (
                            <Badge variant="outline">{model.status ?? "active"}</Badge>
                          )}
                          {health && (
                            <Badge variant={health.healthy ? "secondary" : "destructive"}>
                              {health.healthy ? t("models.healthReady") : t("models.healthNeedsAttention")}
                            </Badge>
                          )}
                          {endpointHealth && (
                            <Badge variant={endpointHealth.healthy ? "secondary" : "destructive"}>
                              {endpointHealth.healthy ? t("models.endpointHealthy") : t("models.endpointFailed")}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title={t("models.editModel")}
                            onClick={() => editModel(model)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title={t("models.setDefault")}
                            disabled={model.isDefault || defaultModelMutation.isPending}
                            onClick={() => defaultModelMutation.mutate(model.id)}
                          >
                            <Star className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title={modelHealthMutation.isPending ? t("models.checkingHealth") : t("models.checkHealth")}
                            disabled={modelHealthMutation.isPending}
                            onClick={() => modelHealthMutation.mutate(model.id)}
                          >
                            <Activity className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title={endpointHealthMutation.isPending ? t("models.checkingEndpoint") : t("models.checkEndpoint")}
                            disabled={!model.endpoint || endpointHealthMutation.isPending}
                            onClick={() => endpointHealthMutation.mutate(model.id)}
                          >
                            <Globe className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive"
                            title={t("models.deleteModel")}
                            disabled={deleteModelMutation.isPending}
                            onClick={() => {
                              if (window.confirm(t("models.deleteModelConfirm"))) {
                                deleteModelMutation.mutate(model.id);
                              }
                            }}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("models.storedKeys")}</CardTitle>
          <CardDescription>{t("models.storedKeysDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {apiKeysLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t("models.loadingApiKeys")}</div>
          ) : apiKeysError ? (
            <div className="py-8 text-center text-sm text-destructive">{t("models.failedLoadApiKeys")}</div>
          ) : apiKeys.length === 0 ? (
            <EmptyState
              icon={<KeyRound className="size-10 text-muted-foreground" />}
              title={t("models.emptyApiKeysTitle")}
              description={t("models.emptyApiKeysDescription")}
            />
          ) : (
            <ApiKeyTable
              apiKeys={apiKeys}
              rotatingKeyId={rotatingKeyId}
              rotationValue={rotationValue}
              onRotationValueChange={setRotationValue}
              onStartRotate={(apiKeyId) => {
                setRotatingKeyId(apiKeyId);
                setRotationValue("");
                setNotice(null);
              }}
              onCancelRotate={() => {
                setRotatingKeyId(null);
                setRotationValue("");
              }}
              onRotate={(apiKeyId) => rotateMutation.mutate(apiKeyId)}
              onDelete={(apiKeyId) => deleteApiKeyMutation.mutate(apiKeyId)}
              isRotating={rotateMutation.isPending}
              isDeleting={deleteApiKeyMutation.isPending}
              t={t}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
}

function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon}
      <h3 className="mt-4 text-lg font-medium">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

interface ApiKeyTableProps {
  apiKeys: ApiKeySummary[];
  rotatingKeyId: string | null;
  rotationValue: string;
  onRotationValueChange: (value: string) => void;
  onStartRotate: (apiKeyId: string) => void;
  onCancelRotate: () => void;
  onRotate: (apiKeyId: string) => void;
  onDelete: (apiKeyId: string) => void;
  isRotating: boolean;
  isDeleting: boolean;
  t: (key: TranslationKey) => string;
}

function ApiKeyTable({
  apiKeys,
  rotatingKeyId,
  rotationValue,
  onRotationValueChange,
  onStartRotate,
  onCancelRotate,
  onRotate,
  onDelete,
  isRotating,
  isDeleting,
  t,
}: ApiKeyTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("common.name")}</TableHead>
          <TableHead>{t("models.provider")}</TableHead>
          <TableHead>{t("models.apiKey")}</TableHead>
          <TableHead>{t("common.status")}</TableHead>
          <TableHead className="text-right">{t("common.actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {apiKeys.map((apiKey) => {
          const isRotatingCurrent = rotatingKeyId === apiKey.id;
          return (
            <TableRow key={apiKey.id}>
              <TableCell className="font-medium">{apiKey.label ?? apiKey.provider}</TableCell>
              <TableCell>{apiKey.provider}</TableCell>
              <TableCell className="font-mono text-xs">••••••••••••</TableCell>
              <TableCell>
                <Badge variant="outline">{apiKey.status ?? "active"}</Badge>
              </TableCell>
              <TableCell>
                {isRotatingCurrent ? (
                  <form
                    className="flex justify-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      onRotate(apiKey.id);
                    }}
                  >
                    <Input
                      className="h-8 max-w-72"
                      type="password"
                      value={rotationValue}
                      onChange={(event) => onRotationValueChange(event.target.value)}
                      required
                    />
                    <Button type="submit" size="sm" disabled={isRotating}>
                      <Save className="size-4" />
                      {t("models.rotate")}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={onCancelRotate}>
                      <X className="size-4" />
                      {t("common.cancel")}
                    </Button>
                  </form>
                ) : (
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t("models.rotateApiKey")}
                      onClick={() => onStartRotate(apiKey.id)}
                    >
                      <RotateCw className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive"
                      title={t("models.deleteApiKey")}
                      disabled={isDeleting}
                      onClick={() => {
                        if (window.confirm(t("models.deleteApiKeyConfirm"))) {
                          onDelete(apiKey.id);
                        }
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
