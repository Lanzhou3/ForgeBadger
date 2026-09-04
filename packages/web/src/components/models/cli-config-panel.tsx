"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FileCode2, Pencil, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { CliBrandChip } from "@/components/cli-brand-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
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
import { cn } from "@/lib/utils";

const cliAdapters: RuntimeAdapterId[] = ["claude", "opencode", "codex", "kimi"];

export function CliConfigPanel() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const queryClient = useQueryClient();

  const [expanded, setExpanded] = useState(false);
  const [adapter, setAdapter] = useState<RuntimeAdapterId>("codex");

  const fieldsQuery = useQuery({
    queryKey: ["cli-config-fields", adapter],
    queryFn: () => getCliConfigFields(adapter),
    enabled: expanded,
  });
  const snapshotQuery = useQuery({
    queryKey: ["cli-config", adapter],
    queryFn: () => getCliConfig(adapter),
    retry: false,
    enabled: expanded,
  });
  const valuesQuery = useQuery({
    queryKey: ["cli-config-field-values", adapter],
    queryFn: () => getCliConfigFieldValues(adapter),
    retry: false,
    enabled: expanded,
  });

  const snapshot = snapshotQuery.data;
  const mainFile = snapshot
    ? snapshot.files.find((file) => snapshot.configFile.endsWith(file.relativePath)) ?? snapshot.files[0]
    : undefined;
  const mainFileQuery = useQuery({
    queryKey: ["cli-config-file", adapter, mainFile?.relativePath],
    queryFn: () => getCliConfigFile(adapter, mainFile!.relativePath),
    enabled: expanded && Boolean(mainFile?.relativePath),
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
    <Card className="forgebadger-animate-in">
      <CardHeader className="cursor-pointer select-none" onClick={() => setExpanded((v) => !v)}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">{t("models.cliConfigSection")}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{t("models.cliConfigSectionDescription")}</p>
          </div>
          <ChevronDown
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", expanded && "rotate-180")}
          />
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-5 border-t border-border/70 pt-5">
          {!isAdmin && (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <ShieldAlert className="size-3.5 shrink-0" />
              {t("models.cliConfigAdminOnly")}
            </div>
          )}

          <Tabs value={adapter} onValueChange={(value) => setAdapter(value as RuntimeAdapterId)}>
            <TabsList>
              {cliAdapters.map((id) => (
                <TabsTrigger key={id} value={id}>
                  <CliBrandChip aiTool={id} />
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {/* Common fields */}
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t("cliConfig.commonFields")}</h3>
            {fieldsQuery.isLoading ? (
              <StateLine text={t("common.loading")} />
            ) : fieldsQuery.error ? (
              <StateLine destructive text={message(fieldsQuery.error, t("cliConfig.loadFailed"))} />
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {(fieldsQuery.data?.fields ?? []).map((field) => (
                  <FieldMetadata
                    key={field.key}
                    field={field}
                    value={valuesQuery.data?.values[field.key]}
                    valuesLoading={valuesQuery.isLoading}
                    t={t}
                  />
                ))}
              </div>
            )}
            {valuesQuery.error ? (
              <StateLine destructive text={message(valuesQuery.error, t("cliConfig.loadFieldValuesFailed"))} />
            ) : null}
          </section>

          {/* Config metadata */}
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t("cliConfig.configMetadata")}</h3>
            {snapshotQuery.isLoading ? (
              <StateLine text={t("common.loading")} />
            ) : snapshotQuery.error || !snapshot ? (
              <StateLine destructive text={message(snapshotQuery.error, t("cliConfig.loadFailed"))} />
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <Metadata label={t("cliConfig.configRoot")} value={snapshot.configRoot} />
                  <Metadata label={t("cliConfig.mainConfigFile")} value={snapshot.configFile} />
                  <Metadata label={t("cliConfig.defaultModel")} value={snapshot.defaultModel || "—"} />
                  <Metadata label={t("cliConfig.providers")} value={String(snapshot.providers.length)} />
                </div>
                <div className="space-y-2">
                  {snapshot.files.map((file) => (
                    <div
                      key={file.relativePath}
                      className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm"
                    >
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate font-mono text-xs">{file.relativePath}</span>
                      </span>
                      <span className="flex shrink-0 gap-2">
                        <Badge variant="outline">{file.fileType}</Badge>
                        <Badge variant={file.exists ? "secondary" : "outline"}>
                          {file.exists ? `${file.sizeBytes} B` : t("cliConfig.fileMissing")}
                        </Badge>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* Raw editor */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">
                {t("cliConfig.rawEditor")}
                {mainFile ? (
                  <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                    {mainFile.relativePath}
                  </span>
                ) : null}
              </h3>
              {!editing ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!isAdmin || !mainFile || mainFileQuery.isLoading}
                  title={!isAdmin ? t("models.cliConfigAdminOnly") : undefined}
                  onClick={() => {
                    setDraft(mainFileQuery.data?.content ?? "");
                    setEditing(true);
                  }}
                >
                  <Pencil className="size-4" />
                  {t("cliConfig.editRawFile")}
                </Button>
              ) : null}
            </div>
            {!mainFile ? (
              <StateLine text={t("common.loading")} />
            ) : editing ? (
              <div className="space-y-3">
                <textarea
                  aria-label={t("cliConfig.rawEditor")}
                  className="min-h-64 w-full rounded-md border bg-background p-3 font-mono text-xs"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  spellCheck={false}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={saveMutation.isPending}
                    onClick={() => setEditing(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button type="button" size="sm" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                    {saveMutation.isPending ? t("common.saving") : t("common.save")}
                  </Button>
                </div>
              </div>
            ) : mainFileQuery.isLoading ? (
              <StateLine text={t("common.loading")} />
            ) : mainFileQuery.error ? (
              <StateLine destructive text={message(mainFileQuery.error, t("cliConfig.loadFailed"))} />
            ) : mainFileQuery.data?.content !== undefined ? (
              <pre className="max-h-96 overflow-auto rounded-md border border-border/70 bg-muted/20 p-3 font-mono text-xs whitespace-pre-wrap">
                {mainFileQuery.data.content}
              </pre>
            ) : (
              <StateLine text={t("cliConfig.rawFileContentUnavailable")} />
            )}
          </section>
        </CardContent>
      )}
    </Card>
  );
}

function FieldMetadata({
  field,
  value,
  valuesLoading,
  t,
}: {
  field: CliConfigFieldSpec;
  value: unknown;
  valuesLoading: boolean;
  t: (key: any) => string;
}) {
  const displayed = valuesLoading
    ? t("common.loading")
    : field.type === "secret"
      ? value === true
        ? t("cliConfig.hasKey")
        : t("cliConfig.noKey")
      : value === undefined || value === ""
        ? t("cliConfig.fieldNotSet")
        : String(value);
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2">
      <div className="text-sm font-medium">{field.label}</div>
      <div className="mt-1 font-mono text-xs text-muted-foreground">{field.path}</div>
      <div className="mt-2 text-xs">{displayed}</div>
    </div>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-all font-mono text-xs">{value}</div>
    </div>
  );
}

function StateLine({ text, destructive = false }: { text: string; destructive?: boolean }) {
  return (
    <div
      className={`rounded-md border border-dashed px-4 py-6 text-center text-sm ${
        destructive ? "text-destructive" : "text-muted-foreground"
      }`}
    >
      {text}
    </div>
  );
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
