"use client";

import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
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
import { scanProject, importProjectWithConfig, type ScanResult } from "@/lib/api";
import { useLanguage } from "@/hooks/use-language";

const pathSchema = z.object({
  path: z.string().min(1, "Path is required"),
});

type PathValues = z.infer<typeof pathSchema>;

const confirmSchema = z.object({
  name: z.string().min(1, "Name is required"),
  aiTool: z.string().min(1, "AI Tool is required"),
});

type ConfirmValues = z.infer<typeof confirmSchema>;

type Step = "path" | "scan" | "confirm";

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
    },
  });

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
      });
    },
    onSuccess: (result) => {
      const configStatus = result.configStatus === "failed" ? "?configStatus=failed" : "";
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

  return (
    <div className="p-6 space-y-4 max-w-2xl">
      <Button variant="ghost" size="sm" onClick={() => router.push("/projects")}>
        <ArrowLeft className="mr-2 size-4" />
        {t("projects.back")}
      </Button>

      <div>
        <h1 className="text-2xl font-semibold">{t("projects.importTitle")}</h1>
        <p className="mt-1 text-muted-foreground">
          {t("projects.importSubtitle")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
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

                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => router.push("/projects")}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button type="submit" disabled={scanMutation.isPending}>
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
                  <CheckCircle2 className="size-5 text-green-500" />
                ) : (
                  <XCircle className="size-5 text-destructive" />
                )}
                <span className="text-sm">
                  {scanResult.exists && scanResult.isDirectory
                    ? t("projects.validDirectory")
                    : scanResult.exists
                      ? t("projects.pathNotDirectory")
                      : t("projects.directoryNotFound")}
                </span>
              </div>

              <div className="rounded-md border bg-muted/50 p-3">
                <p className="text-sm font-mono text-muted-foreground">
                  {scanResult.path}
                </p>
              </div>

              {!scanResult.exists || !scanResult.isDirectory ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      {t("projects.validDirectoryRequired")}
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="flex justify-between gap-3">
                <Button type="button" variant="outline" onClick={goBack}>
                  {t("common.back")}
                </Button>
                <Button
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
                      <FormLabel>{t("common.aiTool")}</FormLabel>
                      <FormControl>
                        <select
                          {...field}
                        className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                      >
                        <option value="claude">Claude Code</option>
                        <option value="opencode">OpenCode</option>
                        <option value="codex">Codex CLI</option>
                      </select>
                      </FormControl>
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

                <div className="flex justify-between gap-3">
                  <Button type="button" variant="outline" onClick={goBack}>
                    {t("common.back")}
                  </Button>
                  <Button type="submit" disabled={importMutation.isPending}>
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
