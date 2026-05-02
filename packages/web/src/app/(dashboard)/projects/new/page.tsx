"use client";

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
import { createProjectWithConfig } from "@/lib/api";
import { useLanguage } from "@/hooks/use-language";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  path: z.string().min(1, "Path is required"),
  aiTool: z.string().min(1, "AI Tool is required"),
  description: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewProjectPage() {
  const router = useRouter();
  const { t } = useLanguage();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      path: "",
      aiTool: "claude",
      description: "",
    },
  });

  const mutation = useMutation({
    mutationFn: createProjectWithConfig,
    onSuccess: (result) => {
      const configStatus = result.configStatus === "failed" ? "?configStatus=failed" : "";
      router.push(`/projects/${result.project.id}${configStatus}`);
    },
  });

  function onSubmit(values: FormValues) {
    mutation.mutate(values);
  }

  return (
    <div className="p-6 space-y-4 max-w-2xl">
      <Button variant="ghost" size="sm" onClick={() => router.push("/projects")}>
        <ArrowLeft className="mr-2 size-4" />
        {t("projects.back")}
      </Button>

      <div>
        <h1 className="text-2xl font-semibold">{t("projects.create")}</h1>
        <p className="mt-1 text-muted-foreground">
          {t("projects.newSubtitle")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("projects.details")}</CardTitle>
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

              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push("/projects")}
                >
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={mutation.isPending}>
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
