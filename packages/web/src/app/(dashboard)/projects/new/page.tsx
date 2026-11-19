"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
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
import { DirectoryPathInput } from "@/components/projects/DirectoryPathInput";
import { TemplateSelect } from "@/components/projects/template-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { createProject } from "@/lib/api";
import { toast } from "@/lib/toast";
import { useLanguage } from "@/hooks/use-language";

interface FormValues {
  name: string;
  path: string;
  description?: string;
}

export default function NewProjectPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [templateId, setTemplateId] = useState("");
  const [initGit, setInitGit] = useState(true);

  const formSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("projects.nameRequired")),
        path: z.string().min(1, t("projects.pathRequired")),
        description: z.string().optional(),
      }),
    [t]
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      path: "",
      description: "",
    },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      createProject(
        templateId
          ? { ...values, templateId, initGit }
          : { ...values, initGit },
      ),
    onSuccess: (result) => {
      if (result.gitInitError) {
        toast.warning(result.gitInitError);
      }
      router.push(`/projects/${result.project.id}`);
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

      <Card className="forgebadger-animate-in">
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
                      <Input placeholder={t("projects.namePlaceholder")} {...field} />
                    </FormControl>
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
                      <DirectoryPathInput
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="/path/to/project"
                      />
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

              <FormItem>
                <FormLabel>{t("templates.selectTemplate")}</FormLabel>
                <FormControl>
                  <TemplateSelect
                    value={templateId}
                    onValueChange={setTemplateId}
                    id="template"
                    ariaLabel={t("templates.selectTemplate")}
                  />
                </FormControl>
              </FormItem>

              <div className="flex items-start gap-2.5 rounded-md border border-border/70 bg-muted/30 p-3">
                <Checkbox
                  id="init-git"
                  checked={initGit}
                  onCheckedChange={(checked) => setInitGit(checked === true)}
                  className="mt-0.5"
                />
                <div className="space-y-0.5">
                  <Label htmlFor="init-git" className="cursor-pointer text-sm font-medium">
                    {t("projects.initGit")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t("projects.initGitHint")}
                  </p>
                </div>
              </div>

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
                  variant="brand"
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
