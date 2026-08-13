"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";

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
  createProjectWithConfig,
  defaultTemplateForAiTool,
  listTemplates,
  type RuntimeAdapterId,
} from "@/lib/api";
import { useLanguage } from "@/hooks/use-language";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  path: z.string().min(1, "Path is required"),
  description: z.string().optional(),
  aiTool: z.enum(["claude", "opencode", "codex", "kimi"]),
  templateId: z.string().min(1, "Template is required"),
});

type FormValues = z.infer<typeof formSchema>;

const BUILTIN_TEMPLATES = [
  { id: "builtin-claude-code", name: "Claude Code" },
  { id: "builtin-opencode", name: "OpenCode" },
  { id: "builtin-codex", name: "Codex CLI" },
];

export default function NewProjectPage() {
  const router = useRouter();
  const { t } = useLanguage();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      path: "",
      description: "",
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

  const mutation = useMutation({
    mutationFn: createProjectWithConfig,
    onSuccess: (result) => {
      const configStatus = result.configStatus === "needs_review" || result.configStatus === "failed"
        ? `?configStatus=${result.configStatus}`
        : "";
      router.push(`/projects/${result.project.id}${configStatus}`);
    },
  });

  function onSubmit(values: FormValues) {
    mutation.mutate(values);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => router.push("/projects")}>
          <ArrowLeft className="size-4" />
          {t("projects.back")}
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("projects.create")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("projects.newSubtitle")}
          </p>
        </div>
      </div>

      <Card className="of-animate-in">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">{t("projects.details")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("common.name")}</FormLabel>
                    <FormControl>
                      <Input placeholder="My Project" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
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
                          form.setValue("templateId", defaultTemplateForAiTool(aiTool));
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
                control={form.control}
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

              <FormField
                control={form.control}
                name="path"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("common.path")}</FormLabel>
                    <FormControl>
                      <Input placeholder="/path/to/project" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("common.description")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("projects.optionalDescription")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {mutation.isError && (
                <p className="text-sm text-destructive">
                  {mutation.error instanceof Error
                    ? mutation.error.message
                    : t("projects.failedCreateProject")}
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
                  disabled={mutation.isPending}
                >
                  {mutation.isPending ? t("projects.creating") : t("projects.create")}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
