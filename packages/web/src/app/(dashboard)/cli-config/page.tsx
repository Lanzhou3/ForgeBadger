"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, FileCode2, Pencil } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { CliBrandChip } from "@/components/cli-brand-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/hooks/use-language";
import {
  getCliConfig,
  getCliConfigFields,
  getCliConfigFieldValues,
  getCliConfigFile,
  writeCliConfigFile,
  type CliConfigFieldSpec,
  type RuntimeAdapterId,
} from "@/lib/api";

const cliAdapters: RuntimeAdapterId[] = ["claude", "opencode", "codex", "kimi"];

export default function CliConfigPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [adapter, setAdapter] = useState<RuntimeAdapterId>("codex");
  const fieldsQuery = useQuery({ queryKey: ["cli-config-fields", adapter], queryFn: () => getCliConfigFields(adapter) });
  const snapshotQuery = useQuery({ queryKey: ["cli-config", adapter], queryFn: () => getCliConfig(adapter), retry: false });
  const valuesQuery = useQuery({ queryKey: ["cli-config-field-values", adapter], queryFn: () => getCliConfigFieldValues(adapter), retry: false });
  const snapshot = snapshotQuery.data;
  const mainFile = snapshot
    ? snapshot.files.find((file) => snapshot.configFile.endsWith(file.relativePath)) ?? snapshot.files[0]
    : undefined;
  const mainFileQuery = useQuery({
    queryKey: ["cli-config-file", adapter, mainFile?.relativePath],
    queryFn: () => getCliConfigFile(adapter, mainFile!.relativePath),
    enabled: Boolean(mainFile?.relativePath),
    retry: false,
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    setEditing(false);
    setDraft("");
  }, [adapter]);

  const saveMutation = useMutation({
    mutationFn: () => writeCliConfigFile(adapter, mainFile!.relativePath, draft),
    onSuccess: async () => {
      toast.success(t("cliConfig.saved"));
      setEditing(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cli-config", adapter] }),
        queryClient.invalidateQueries({ queryKey: ["cli-config-file", adapter, mainFile?.relativePath] }),
        queryClient.invalidateQueries({ queryKey: ["cli-config-field-values", adapter] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("cliConfig.saveFailed"));
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold tracking-tight">{t("cliConfig.title")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("cliConfig.description")}</p></div>
        <Button asChild size="sm" variant="outline"><Link href="/models">{t("cliConfig.openModelCenter")}<ArrowUpRight className="size-4" /></Link></Button>
      </div>
      <Tabs value={adapter} onValueChange={(value) => setAdapter(value as RuntimeAdapterId)}><TabsList>{cliAdapters.map((id) => <TabsTrigger key={id} value={id}><CliBrandChip aiTool={id} /></TabsTrigger>)}</TabsList></Tabs>

      <Card>
        <CardHeader><CardTitle className="text-sm">{t("cliConfig.commonFields")}</CardTitle></CardHeader>
        <CardContent>
          {fieldsQuery.isLoading ? <StateLine text={t("common.loading")} /> : fieldsQuery.error ? <StateLine destructive text={message(fieldsQuery.error, t("cliConfig.loadFailed"))} /> : (
            <div className="grid gap-2 md:grid-cols-2">{(fieldsQuery.data?.fields ?? []).map((field) => <FieldMetadata key={field.key} field={field} value={valuesQuery.data?.values[field.key]} valuesLoading={valuesQuery.isLoading} t={t} />)}</div>
          )}
          {valuesQuery.error ? <StateLine destructive text={message(valuesQuery.error, t("cliConfig.loadFieldValuesFailed"))} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">{t("cliConfig.configMetadata")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {snapshotQuery.isLoading ? <StateLine text={t("common.loading")} /> : snapshotQuery.error || !snapshot ? <StateLine destructive text={message(snapshotQuery.error, t("cliConfig.loadFailed"))} /> : (
            <><div className="grid gap-3 md:grid-cols-2"><Metadata label={t("cliConfig.configRoot")} value={snapshot.configRoot} /><Metadata label={t("cliConfig.mainConfigFile")} value={snapshot.configFile} /><Metadata label={t("cliConfig.defaultModel")} value={snapshot.defaultModel || "—"} /><Metadata label={t("cliConfig.providers")} value={String(snapshot.providers.length)} /></div><div className="space-y-2">{snapshot.files.map((file) => <div key={file.relativePath} className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm"><span className="inline-flex min-w-0 items-center gap-2"><FileCode2 className="size-4 shrink-0 text-muted-foreground" /><span className="truncate font-mono text-xs">{file.relativePath}</span></span><span className="flex shrink-0 gap-2"><Badge variant="outline">{file.fileType}</Badge><Badge variant={file.exists ? "secondary" : "outline"}>{file.exists ? `${file.sizeBytes} B` : t("cliConfig.fileMissing")}</Badge></span></div>)}</div></>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm">{t("cliConfig.rawEditor")}{mainFile ? <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">{mainFile.relativePath}</span> : null}</CardTitle>
            {!editing ? (
              <Button type="button" size="sm" variant="outline" disabled={!mainFile || mainFileQuery.isLoading} onClick={() => { setDraft(mainFileQuery.data?.content ?? ""); setEditing(true); }}>
                <Pencil className="size-4" />
                {t("cliConfig.editRawFile")}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {!mainFile ? <StateLine text={t("common.loading")} /> : editing ? (
            <div className="space-y-3">
              <textarea
                aria-label={t("cliConfig.rawEditor")}
                className="min-h-64 w-full rounded-md border bg-background p-3 font-mono text-xs"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                spellCheck={false}
              />
              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="outline" disabled={saveMutation.isPending} onClick={() => setEditing(false)}>{t("common.cancel")}</Button>
                <Button type="button" size="sm" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>{saveMutation.isPending ? t("common.saving") : t("common.save")}</Button>
              </div>
            </div>
          ) : mainFileQuery.isLoading ? <StateLine text={t("common.loading")} /> : mainFileQuery.error ? <StateLine destructive text={message(mainFileQuery.error, t("cliConfig.loadFailed"))} /> : mainFileQuery.data?.content !== undefined ? (
            <pre className="max-h-96 overflow-auto rounded-md border border-border/70 bg-muted/20 p-3 font-mono text-xs whitespace-pre-wrap">{mainFileQuery.data.content}</pre>
          ) : (
            <StateLine text={t("cliConfig.rawFileContentUnavailable")} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FieldMetadata({ field, value, valuesLoading, t }: { field: CliConfigFieldSpec; value: unknown; valuesLoading: boolean; t: (key: any) => string }) {
  const displayed = valuesLoading ? t("common.loading") : field.type === "secret" ? (value === true ? t("cliConfig.hasKey") : t("cliConfig.noKey")) : value === undefined || value === "" ? t("cliConfig.fieldNotSet") : String(value);
  return <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2"><div className="text-sm font-medium">{field.label}</div><div className="mt-1 font-mono text-xs text-muted-foreground">{field.path}</div><div className="mt-2 text-xs">{displayed}</div></div>;
}

function Metadata({ label, value }: { label: string; value: string }) { return <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 break-all font-mono text-xs">{value}</div></div>; }
function StateLine({ text, destructive = false }: { text: string; destructive?: boolean }) { return <div className={`rounded-md border border-dashed px-4 py-6 text-center text-sm ${destructive ? "text-destructive" : "text-muted-foreground"}`}>{text}</div>; }
function message(error: unknown, fallback: string): string { return error instanceof Error ? error.message : fallback; }
