"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Boxes,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  Save,
  Server,
  Trash2,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CliBrandChip } from "@/components/cli-brand-chip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getCliConfig,
  getCliConfigFile,
  removeCliModel,
  removeCliProvider,
  setCliDefaultModel,
  upsertCliModel,
  upsertCliProvider,
  writeCliConfigFile,
  type CliConfigSnapshot,
  type RuntimeAdapterId,
} from "@/lib/api";
import { useLanguage } from "@/hooks/use-language";
import { cn } from "@/lib/utils";

const cliAdapters: RuntimeAdapterId[] = ["claude", "opencode", "codex", "kimi"];

interface ProviderFormState {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  apiKey: string;
  envKey: string;
}

const emptyProviderForm: ProviderFormState = {
  id: "",
  name: "",
  protocol: "",
  baseUrl: "",
  apiKey: "",
  envKey: "",
};

interface ModelFormState {
  alias: string;
  provider: string;
  modelId: string;
}

const emptyModelForm: ModelFormState = { alias: "", provider: "", modelId: "" };

export default function CliConfigPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [adapter, setAdapter] = useState<RuntimeAdapterId>("kimi");
  const [providerForm, setProviderForm] = useState<ProviderFormState>(emptyProviderForm);
  const [modelForm, setModelForm] = useState<ModelFormState>(emptyModelForm);
  const [defaultModelInput, setDefaultModelInput] = useState("");
  const [defaultProviderInput, setDefaultProviderInput] = useState("");
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [fileDraft, setFileDraft] = useState("");
  const [fileRevealed, setFileRevealed] = useState(false);

  const { data: snapshot, isLoading, error } = useQuery({
    queryKey: ["cli-config", adapter],
    queryFn: () => getCliConfig(adapter),
  });

  const invalidate = (next: CliConfigSnapshot) => {
    queryClient.setQueryData(["cli-config", adapter], next);
  };

  const providerMutation = useMutation({
    mutationFn: () =>
      upsertCliProvider(adapter, providerForm.id.trim(), {
        ...(providerForm.name.trim() ? { name: providerForm.name.trim() } : {}),
        ...(providerForm.protocol.trim() ? { protocol: providerForm.protocol.trim() } : {}),
        ...(providerForm.baseUrl.trim() ? { baseUrl: providerForm.baseUrl.trim() } : {}),
        ...(providerForm.apiKey ? { apiKey: providerForm.apiKey } : {}),
        ...(providerForm.envKey.trim() ? { envKey: providerForm.envKey.trim() } : {}),
      }),
    onSuccess: (next) => {
      invalidate(next);
      setProviderForm(emptyProviderForm);
    },
  });

  const removeProviderMutation = useMutation({
    mutationFn: (providerId: string) => removeCliProvider(adapter, providerId),
    onSuccess: invalidate,
  });

  const modelMutation = useMutation({
    mutationFn: () =>
      upsertCliModel(adapter, {
        alias: modelForm.alias.trim(),
        provider: modelForm.provider.trim(),
        modelId: modelForm.modelId.trim(),
      }),
    onSuccess: (next) => {
      invalidate(next);
      setModelForm(emptyModelForm);
    },
  });

  const removeModelMutation = useMutation({
    mutationFn: (alias: string) => removeCliModel(adapter, alias),
    onSuccess: invalidate,
  });

  const defaultModelMutation = useMutation({
    mutationFn: () =>
      setCliDefaultModel(
        adapter,
        defaultModelInput.trim(),
        adapter === "codex" && defaultProviderInput.trim() ? defaultProviderInput.trim() : undefined
      ),
    onSuccess: invalidate,
  });

  const saveFileMutation = useMutation({
    mutationFn: () => writeCliConfigFile(adapter, selectedFilePath, fileDraft),
    onSuccess: invalidate,
  });

  const files = useMemo(() => snapshot?.files ?? [], [snapshot?.files]);
  const providers = useMemo(() => snapshot?.providers ?? [], [snapshot?.providers]);
  const models = useMemo(() => snapshot?.models ?? [], [snapshot?.models]);
  const selectedFile = files.find((file) => file.relativePath === selectedFilePath);

  useEffect(() => {
    setProviderForm(emptyProviderForm);
    setModelForm(emptyModelForm);
    setDefaultProviderInput("");
    setFileRevealed(false);
  }, [adapter]);

  useEffect(() => {
    setDefaultModelInput(snapshot?.defaultModel ?? "");
  }, [snapshot?.defaultModel]);

  useEffect(() => {
    if (files.length === 0) return;
    if (!selectedFilePath || !files.some((file) => file.relativePath === selectedFilePath)) {
      setSelectedFilePath(snapshot?.configFile ?? files[0]?.relativePath ?? "");
    }
  }, [files, selectedFilePath, snapshot?.configFile]);

  useEffect(() => {
    setFileDraft(selectedFile?.content ?? "");
    setFileRevealed(false);
  }, [selectedFile?.content, selectedFile?.relativePath]);

  const revealFileMutation = useMutation({
    mutationFn: (reveal: boolean) => getCliConfigFile(adapter, selectedFilePath, reveal),
    onSuccess: (file) => {
      setFileDraft(file.content);
      setFileRevealed(!file.redacted);
    },
  });

  const protocolOptions = protocolChoicesFor(adapter);
  const providerIdFixed = adapter === "claude";
  const showApiKeyField = adapter !== "codex";
  const showEnvKeyField = adapter === "codex";

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("cliConfig.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("cliConfig.description")}</p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/models">
            {t("cliConfig.openModelCenter")}
            <ArrowUpRight className="size-4" />
          </Link>
        </Button>
      </div>

      <Card className="of-animate-in">
        <CardContent className="flex items-center gap-3 p-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
            <KeyRound className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{t("cliConfig.manageInModelCenter")}</div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {t("cliConfig.manageInModelCenterDescription")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Tabs
        value={adapter}
        onValueChange={(value) => setAdapter(value as RuntimeAdapterId)}
        className="of-animate-in"
      >
        <TabsList>
          {cliAdapters.map((adapterId) => (
            <TabsTrigger key={adapterId} value={adapterId}>
              <CliBrandChip aiTool={adapterId} />
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isLoading ? (
        <Card className="of-animate-in">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("common.loading")}
          </CardContent>
        </Card>
      ) : error || !snapshot ? (
        <Card className="of-animate-in">
          <CardContent className="py-10 text-center text-sm text-destructive">
            {error instanceof Error ? error.message : t("cliConfig.loadFailed")}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="of-animate-in" style={{ animationDelay: "40ms" }}>
            <CardContent className="grid gap-3 p-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground">{t("cliConfig.configRoot")}</div>
                <div className="break-all rounded-md bg-muted/40 px-2.5 py-1.5 font-mono text-xs">
                  {snapshot.configRoot}
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground">{t("cliConfig.mainConfigFile")}</div>
                <div className="break-all rounded-md bg-muted/40 px-2.5 py-1.5 font-mono text-xs">
                  {snapshot.configRoot}/{snapshot.configFile}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="of-animate-in" style={{ animationDelay: "80ms" }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">{t("cliConfig.providers")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {adapter === "claude" && (
                <p className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  {t("cliConfig.claudeEndpointNote")}
                </p>
              )}
              {adapter === "codex" && (
                <p className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  {t("cliConfig.codexEnvKeyNote")}
                </p>
              )}
              {providers.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <div className="flex size-10 items-center justify-center rounded-md bg-brand/10 text-brand">
                    <Server className="size-5" />
                  </div>
                  <div className="text-sm font-medium">{t("cliConfig.noProviders")}</div>
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("cliConfig.providerId")}</TableHead>
                        <TableHead>{t("cliConfig.protocol")}</TableHead>
                        <TableHead>{t("cliConfig.baseUrl")}</TableHead>
                        <TableHead>{t("cliConfig.apiKey")}</TableHead>
                        <TableHead>{t("common.status")}</TableHead>
                        <TableHead className="text-right">{t("common.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {providers.map((provider) => (
                        <TableRow key={provider.id}>
                          <TableCell className="font-medium">
                            {provider.name}
                            <div className="font-mono text-xs text-muted-foreground">{provider.id}</div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{provider.protocol || "—"}</TableCell>
                          <TableCell className="max-w-56 truncate font-mono text-xs">
                            {provider.baseUrl || "—"}
                          </TableCell>
                          <TableCell>
                            {provider.envKey ? (
                              <span className="font-mono text-xs">{provider.envKey}</span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                <span
                                  className={cn(
                                    "size-1.5 shrink-0 rounded-full",
                                    provider.hasApiKey ? "bg-emerald-400" : "bg-amber-400"
                                  )}
                                />
                                {provider.hasApiKey ? t("cliConfig.hasKey") : t("cliConfig.noKey")}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            {provider.isActive && (
                              <Badge
                                variant="secondary"
                                className="border-brand/30 bg-brand/10 text-brand"
                              >
                                {t("cliConfig.active")}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setProviderForm({
                                    id: provider.id,
                                    name: provider.name,
                                    protocol: provider.protocol,
                                    baseUrl: provider.baseUrl,
                                    apiKey: "",
                                    envKey: provider.envKey ?? "",
                                  })
                                }
                              >
                                {t("common.edit")}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:bg-destructive/10"
                                onClick={() => {
                                  if (window.confirm(t("cliConfig.deleteProviderConfirm"))) {
                                    removeProviderMutation.mutate(provider.id);
                                  }
                                }}
                              >
                                <Trash2 className="size-4" />
                                <span className="sr-only">{t("common.delete")}</span>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <div className="grid gap-3 rounded-md border border-border/70 bg-muted/20 p-3 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="provider-id">{t("cliConfig.providerId")}</Label>
                  <Input
                    id="provider-id"
                    value={providerIdFixed ? "anthropic" : providerForm.id}
                    disabled={providerIdFixed}
                    placeholder={adapter === "kimi" ? "moonshot" : adapter === "codex" ? "gateway" : "provider-id"}
                    onChange={(event) => setProviderForm((form) => ({ ...form, id: event.target.value }))}
                  />
                </div>
                {adapter !== "claude" && (
                  <div className="space-y-2">
                    <Label htmlFor="provider-name">{t("cliConfig.providerName")}</Label>
                    <Input
                      id="provider-name"
                      value={providerForm.name}
                      onChange={(event) => setProviderForm((form) => ({ ...form, name: event.target.value }))}
                    />
                  </div>
                )}
                {protocolOptions.length > 0 ? (
                  <div className="space-y-2">
                    <Label htmlFor="provider-protocol">{t("cliConfig.protocol")}</Label>
                    <select
                      id="provider-protocol"
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      value={providerForm.protocol || protocolOptions[0]}
                      onChange={(event) => setProviderForm((form) => ({ ...form, protocol: event.target.value }))}
                    >
                      {protocolOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : adapter === "opencode" ? (
                  <div className="space-y-2">
                    <Label htmlFor="provider-protocol">{t("cliConfig.protocol")}</Label>
                    <Input
                      id="provider-protocol"
                      value={providerForm.protocol}
                      placeholder="@ai-sdk/openai-compatible"
                      onChange={(event) => setProviderForm((form) => ({ ...form, protocol: event.target.value }))}
                    />
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor="provider-base-url">{t("cliConfig.baseUrl")}</Label>
                  <Input
                    id="provider-base-url"
                    value={providerForm.baseUrl}
                    placeholder="https://api.example.com/v1"
                    onChange={(event) => setProviderForm((form) => ({ ...form, baseUrl: event.target.value }))}
                  />
                </div>
                {showApiKeyField && (
                  <div className="space-y-2">
                    <Label htmlFor="provider-api-key">{t("cliConfig.apiKey")}</Label>
                    <Input
                      id="provider-api-key"
                      type="password"
                      value={providerForm.apiKey}
                      placeholder={t("cliConfig.apiKeyKeepPlaceholder")}
                      onChange={(event) => setProviderForm((form) => ({ ...form, apiKey: event.target.value }))}
                    />
                  </div>
                )}
                {showEnvKeyField && (
                  <div className="space-y-2">
                    <Label htmlFor="provider-env-key">{t("cliConfig.envKey")}</Label>
                    <Input
                      id="provider-env-key"
                      value={providerForm.envKey}
                      placeholder="EXAMPLE_API_KEY"
                      onChange={(event) => setProviderForm((form) => ({ ...form, envKey: event.target.value }))}
                    />
                  </div>
                )}
                <div className="flex items-end">
                  <Button
                    size="sm"
                    onClick={() => providerMutation.mutate()}
                    disabled={
                      providerMutation.isPending ||
                      (!providerIdFixed && !providerForm.id.trim())
                    }
                  >
                    <Plus className="size-4" />
                    {providerMutation.isPending
                      ? t("common.saving")
                      : providers.some((provider) => provider.id === (providerIdFixed ? "anthropic" : providerForm.id.trim()))
                        ? t("cliConfig.updateProvider")
                        : t("cliConfig.addProvider")}
                  </Button>
                </div>
              </div>
              {providerMutation.isError && (
                <p className="text-sm text-destructive">
                  {providerMutation.error instanceof Error
                    ? providerMutation.error.message
                    : t("cliConfig.saveFailed")}
                </p>
              )}
              {removeProviderMutation.isError && (
                <p className="text-sm text-destructive">
                  {removeProviderMutation.error instanceof Error
                    ? removeProviderMutation.error.message
                    : t("cliConfig.saveFailed")}
                </p>
              )}
            </CardContent>
          </Card>

          {adapter === "kimi" && (
            <Card className="of-animate-in" style={{ animationDelay: "120ms" }}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">{t("cliConfig.models")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {models.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-8 text-center">
                    <div className="flex size-10 items-center justify-center rounded-md bg-brand/10 text-brand">
                      <Boxes className="size-5" />
                    </div>
                    <div className="text-sm font-medium">{t("cliConfig.noModels")}</div>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("cliConfig.modelAlias")}</TableHead>
                          <TableHead>{t("cliConfig.providerId")}</TableHead>
                          <TableHead>{t("cliConfig.modelId")}</TableHead>
                          <TableHead className="text-right">{t("common.actions")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {models.map((model) => (
                          <TableRow key={model.alias}>
                            <TableCell className="font-mono text-xs">{model.alias}</TableCell>
                            <TableCell className="font-mono text-xs">{model.provider}</TableCell>
                            <TableCell className="font-mono text-xs">{model.modelId}</TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:bg-destructive/10"
                                onClick={() => {
                                  if (window.confirm(t("cliConfig.deleteModelConfirm"))) {
                                    removeModelMutation.mutate(model.alias);
                                  }
                                }}
                              >
                                <Trash2 className="size-4" />
                                <span className="sr-only">{t("common.delete")}</span>
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <div className="grid gap-3 rounded-md border border-border/70 bg-muted/20 p-3 md:grid-cols-4">
                  <div className="space-y-2">
                    <Label htmlFor="model-alias">{t("cliConfig.modelAlias")}</Label>
                    <Input
                      id="model-alias"
                      value={modelForm.alias}
                      placeholder="moonshot/kimi-k2.5"
                      onChange={(event) => setModelForm((form) => ({ ...form, alias: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="model-provider">{t("cliConfig.providerId")}</Label>
                    <select
                      id="model-provider"
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      value={modelForm.provider}
                      onChange={(event) => setModelForm((form) => ({ ...form, provider: event.target.value }))}
                    >
                      <option value="">{t("cliConfig.providerOptional")}</option>
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="model-id">{t("cliConfig.modelId")}</Label>
                    <Input
                      id="model-id"
                      value={modelForm.modelId}
                      placeholder="kimi-k2.5"
                      onChange={(event) => setModelForm((form) => ({ ...form, modelId: event.target.value }))}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      size="sm"
                      onClick={() => modelMutation.mutate()}
                      disabled={
                        modelMutation.isPending ||
                        !modelForm.alias.trim() ||
                        !modelForm.provider.trim() ||
                        !modelForm.modelId.trim()
                      }
                    >
                      <Plus className="size-4" />
                      {modelMutation.isPending ? t("common.saving") : t("cliConfig.addModel")}
                    </Button>
                  </div>
                </div>
                {modelMutation.isError && (
                  <p className="text-sm text-destructive">
                    {modelMutation.error instanceof Error
                      ? modelMutation.error.message
                      : t("cliConfig.saveFailed")}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="of-animate-in" style={{ animationDelay: "160ms" }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">{t("cliConfig.defaultModel")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="default-model">{t("cliConfig.defaultModel")}</Label>
                {adapter === "kimi" && models.length > 0 ? (
                  <select
                    id="default-model"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    value={defaultModelInput}
                    onChange={(event) => setDefaultModelInput(event.target.value)}
                  >
                    <option value="">{t("cliConfig.defaultModelPlaceholder")}</option>
                    {models.map((model) => (
                      <option key={model.alias} value={model.alias}>
                        {model.alias}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id="default-model"
                    value={defaultModelInput}
                    placeholder={defaultModelPlaceholderFor(adapter)}
                    onChange={(event) => setDefaultModelInput(event.target.value)}
                  />
                )}
              </div>
              {adapter === "codex" && (
                <div className="space-y-2">
                  <Label htmlFor="default-provider">{t("cliConfig.providerId")}</Label>
                  <select
                    id="default-provider"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    value={defaultProviderInput}
                    onChange={(event) => setDefaultProviderInput(event.target.value)}
                  >
                    <option value="">{t("cliConfig.providerOptional")}</option>
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.id}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex items-end">
                <Button
                  size="sm"
                  onClick={() => defaultModelMutation.mutate()}
                  disabled={defaultModelMutation.isPending || !defaultModelInput.trim()}
                >
                  <Save className="size-4" />
                  {defaultModelMutation.isPending ? t("common.saving") : t("common.save")}
                </Button>
              </div>
              {defaultModelMutation.isError && (
                <p className="text-sm text-destructive md:col-span-3">
                  {defaultModelMutation.error instanceof Error
                    ? defaultModelMutation.error.message
                    : t("cliConfig.saveFailed")}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="of-animate-in" style={{ animationDelay: "200ms" }}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-sm font-semibold">{t("cliConfig.rawEditor")}</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => revealFileMutation.mutate(!fileRevealed)}
                  disabled={!selectedFile?.exists || revealFileMutation.isPending}
                >
                  {fileRevealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  {fileRevealed ? t("cliConfig.hideContent") : t("cliConfig.revealContent")}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="config-file">{t("cliConfig.fileLabel")}</Label>
                <select
                  id="config-file"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:max-w-md"
                  value={selectedFilePath}
                  onChange={(event) => setSelectedFilePath(event.target.value)}
                >
                  {files.map((file) => (
                    <option key={file.relativePath} value={file.relativePath}>
                      {file.relativePath}
                      {file.exists ? "" : ` (${t("cliConfig.fileMissing")})`}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                className="min-h-72 w-full rounded-md border border-input bg-background p-3 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                value={fileDraft}
                onChange={(event) => setFileDraft(event.target.value)}
                spellCheck={false}
              />
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  onClick={() => saveFileMutation.mutate()}
                  disabled={saveFileMutation.isPending || !selectedFilePath}
                >
                  <Save className="size-4" />
                  {saveFileMutation.isPending ? t("common.saving") : t("common.save")}
                </Button>
                {saveFileMutation.isSuccess && !saveFileMutation.isPending && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="size-1.5 rounded-full bg-emerald-400" />
                    {t("cliConfig.saved")}
                  </span>
                )}
              </div>
              {saveFileMutation.isError && (
                <p className="text-sm text-destructive">
                  {saveFileMutation.error instanceof Error
                    ? saveFileMutation.error.message
                    : t("cliConfig.saveFailed")}
                </p>
              )}
              {revealFileMutation.isError && (
                <p className="text-sm text-destructive">
                  {revealFileMutation.error instanceof Error
                    ? revealFileMutation.error.message
                    : t("cliConfig.loadFileFailed")}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function protocolChoicesFor(adapter: RuntimeAdapterId): string[] {
  if (adapter === "kimi") return ["kimi", "anthropic", "openai"];
  if (adapter === "codex") return ["chat", "responses"];
  return [];
}

function defaultModelPlaceholderFor(adapter: RuntimeAdapterId): string {
  if (adapter === "claude") return "claude-sonnet-4-5";
  if (adapter === "opencode") return "provider/model-id";
  if (adapter === "codex") return "gpt-5.1-codex";
  return "provider/model-alias";
}
