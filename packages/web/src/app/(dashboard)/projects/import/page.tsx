"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ArrowLeft, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  defaultTemplateForAiTool,
  importProjectWithConfig,
  listTemplates,
  scanProject,
  type RuntimeAdapterId,
  type ScanResult,
} from "@/lib/api";
import { useLanguage } from "@/hooks/use-language";
import { cn } from "@/lib/utils";

const pathSchema = z.object({
  path: z.string().min(1, "Path is required"),
});

type PathValues = z.infer<typeof pathSchema>;

const confirmSchema = z.object({
  name: z.string().min(1, "Name is required"),
  aiTool: z.enum(["claude", "opencode", "codex", "kimi"]),
  templateId: z.string().min(1, "Template is required"),
});

type ConfirmValues = z.infer<typeof confirmSchema>;

type Step = "path" | "scan" | "confirm";

const STEP_ORDER: Step[] = ["path", "scan", "confirm"];

const BUILTIN_TEMPLATES = [
  { id: "builtin-claude-code", name: "Claude Code" },
  { id: "builtin-opencode", name: "OpenCode" },
  { id: "builtin-codex", name: "Codex CLI" },
];

export default function ImportProjectPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>("path");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scannedPath, setScannedPath] = useState("");

  const pathForm = useForm<PathValues>({
    resolver: zodResolver(pathSchema),
    defaultValues: {
      path: "",
    },
  });

  const confirmForm = useForm<ConfirmValues>({
    resolver: zodResolver(confirmSchema),
    defaultValues: {
      name: "",
      aiTool: "claude",
      templateId: "builtin-claude-code",
    },
  });
  const templatesQuery = useQuery({ queryKey: ["templates"], queryFn: listTemplates });
  const templates = templatesQuery.data?.templates ?? [];
  const templateOptions = [
    ...BUILTIN_TEMPLATES,
    ...templates.filter((template) => !BUILTIN_TEMPLATES.some((builtin) => builtin.id === template.id)),
  ];

  const scanMutation = useMutation({
    mutationFn: scanProject,
    onSuccess: (data) => {
      setScanResult(data);
      setScannedPath(data.path);
      const basename = data.path.split("/").filter(Boolean).pop() ?? "";
      confirmForm.setValue("name", basename);
      setStep("scan");
    },
  });

  const importMutation = useMutation({
    mutationFn: async (values: ConfirmValues) => {
      return importProjectWithConfig({
        path: scannedPath,
        name: values.name,
        aiTool: values.aiTool,
        templateId: values.templateId,
      });
    },
    onSuccess: (result) => {
      const configStatus = result.configStatus === "needs_review" || result.configStatus === "failed"
        ? `?configStatus=${result.configStatus}`
        : "";
      router.push(`/projects/${result.project.id}${configStatus}`);
    },
  });

  function onPathSubmit(values: PathValues) {
    scanMutation.mutate(values.path);
  }

  function onConfirmSubmit(values: ConfirmValues) {
    importMutation.mutate(values);
  }

  function goBack() {
    if (step === "scan") {
      setStep("path");
      setScanResult(null);
    } else if (step === "confirm") {
      setStep("scan");
    }
  }

  const activeStepIndex = STEP_ORDER.indexOf(step);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => router.push("/projects")}>
          <ArrowLeft className="size-4" />
          {t("projects.back")}
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("projects.importTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("projects.importSubtitle")}
          </p>
        </div>
      </div>

      <div className="of-animate-in flex items-center gap-1.5">
        {STEP_ORDER.map((stepId, index) => (
          <div
            key={stepId}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors duration-300",
              index <= activeStepIndex ? "bg-brand" : "bg-muted"
            )}
          />
        ))}
      </div>

      <Card className="of-animate-in" style={{ animationDelay: "40ms" }}>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">
            {step === "path" && t("projects.importStepPath")}
            {step === "scan" && t("projects.importStepScan")}
            {step === "confirm" && t("projects.importStepConfirm")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {step === "path" && (
            <Form {...pathForm}>
              <form onSubmit={pathForm.handleSubmit(onPathSubmit)} className="space-y-4">
              <FormField
                  control={pathForm.control}
                  name="path"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("projects.directoryPath")}</FormLabel>
                      <FormControl>
                        <Input placeholder="/path/to/existing/project" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
              />

                {scanMutation.isError && (
                  <p className="text-sm text-destructive">
                    {scanMutation.error instanceof Error
                      ? scanMutation.error.message
                      : t("projects.failedScan")}
                  </p>
                )}

                <div className="flex justify-end gap-2 border-t border-border/70 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => router.push("/projects")}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    className="bg-brand text-brand-foreground hover:bg-brand/90"
                    disabled={scanMutation.isPending}
                  >
                    {scanMutation.isPending ? t("projects.scanning") : t("projects.scanDirectory")}
                  </Button>
                </div>
              </form>
            </Form>
          )}

          {step === "scan" && scanResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {scanResult.exists && scanResult.isDirectory ? (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
                ) : (
                  <XCircle className="size-4 shrink-0 text-red-400" />
                )}
                <span className="text-sm font-medium">
                  {scanResult.exists && scanResult.isDirectory
                    ? t("projects.validDirectory")
                    : scanResult.exists
                      ? t("projects.pathNotDirectory")
                      : t("projects.directoryNotFound")}
                </span>
              </div>

              <div className="rounded-md border border-border/70 bg-muted/50 p-3">
                <p className="break-all font-mono text-xs text-muted-foreground">
                  {scanResult.path}
                </p>
              </div>

              {!scanResult.exists || !scanResult.isDirectory ? (
                <div className="flex items-center gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 p-3">
                  <AlertTriangle className="size-4 shrink-0 text-amber-400" />
                  <p className="text-sm text-amber-200">
                    {t("projects.validDirectoryRequired")}
                  </p>
                </div>
              ) : null}

              <div className="flex justify-between gap-2 border-t border-border/70 pt-4">
                <Button type="button" variant="outline" size="sm" onClick={goBack}>
                  {t("common.back")}
                </Button>
                <Button
                  size="sm"
                  className="bg-brand text-brand-foreground hover:bg-brand/90"
                  onClick={() => setStep("confirm")}
                  disabled={!scanResult.exists || !scanResult.isDirectory}
                >
                  {t("projects.importTitle")}
                </Button>
              </div>
            </div>
          )}

          {step === "confirm" && (
            <Form {...confirmForm}>
              <form onSubmit={confirmForm.handleSubmit(onConfirmSubmit)} className="space-y-4">
                <FormField
                  control={confirmForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("projects.projectName")}</FormLabel>
                      <FormControl>
                        <Input placeholder="My Project" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={confirmForm.control}
                  name="aiTool"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("projects.runtimeCli")}</FormLabel>
                      <FormControl>
                        <select
                          id="project-ai-tool"
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                          {...field}
                          onChange={(event) => {
                            const aiTool = event.target.value as RuntimeAdapterId;
                            field.onChange(aiTool);
                            confirmForm.setValue("templateId", defaultTemplateForAiTool(aiTool));
                          }}
                        >
                          <option value="claude">Claude Code</option>
                          <option value="opencode">OpenCode</option>
                          <option value="codex">Codex CLI</option>
                          <option value="kimi">Kimi Code</option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={confirmForm.control}
                  name="templateId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("projects.configTemplate")}</FormLabel>
                      <FormControl>
                        <select id="config-template" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" {...field}>
                          {templateOptions.map((template) => (
                            <option key={template.id} value={template.id}>{template.name}</option>
                          ))}
                        </select>
                      </FormControl>
                      <p className="text-xs text-muted-foreground">{t("projects.configTemplateDescription")}</p>
                      <p className="text-xs text-muted-foreground">{t("projects.templateSeedHint")}</p>
                      {templatesQuery.isError && (
                        <p className="text-xs text-destructive">{t("projects.failedLoadTemplates")}</p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {importMutation.isError && (
                  <p className="text-sm text-destructive">
                    {importMutation.error instanceof Error
                      ? importMutation.error.message
                      : t("projects.failedImport")}
                  </p>
                )}

                <div className="flex justify-between gap-2 border-t border-border/70 pt-4">
                  <Button type="button" variant="outline" size="sm" onClick={goBack}>
                    {t("common.back")}
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    className="bg-brand text-brand-foreground hover:bg-brand/90"
                    disabled={importMutation.isPending}
                  >
                    {importMutation.isPending ? t("projects.importing") : t("projects.importTitle")}
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
