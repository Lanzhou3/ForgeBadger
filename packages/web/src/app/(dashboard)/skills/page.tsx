"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Eye, Pencil, Plus, RefreshCw, Save, Sparkles, Trash2, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import {
  createSkill,
  deleteSkill,
  listSkills,
  listSkillSources,
  listSkillTemplates,
  syncLocalSkills,
  toggleSkill,
  updateSkill,
  type Skill,
  type SkillInput,
  type SkillTemplate,
} from "@/lib/api";
import {
  filterByVisibility,
  normalizeVisibility,
  visibilityDescriptionKey,
  visibilityLabelKey,
  visibilityOptions,
  type VisibilityFilter,
} from "@/lib/visibility";
import { useLanguage } from "@/hooks/use-language";

const emptySkillForm: SkillInput = {
  name: "",
  description: "",
  source: "local",
  content: "",
  version: "1.0.0",
  visibility: "private",
};

export default function SkillsPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SkillInput>(emptySkillForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewSkillId, setPreviewSkillId] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("all");
  const [error, setError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["skills"],
    queryFn: listSkills,
  });

  const { data: sourcesData } = useQuery({
    queryKey: ["skill-sources"],
    queryFn: listSkillSources,
  });

  const { data: templatesData } = useQuery({
    queryKey: ["skill-templates"],
    queryFn: listSkillTemplates,
  });

  const sources = sourcesData?.sources ?? [];
  const templates = templatesData?.templates ?? [];
  const sourceFilteredSkills =
    sourceFilter === "all"
      ? data?.skills ?? []
      : (data?.skills ?? []).filter((skill) => skill.source === sourceFilter);
  const filteredSkills = filterByVisibility(sourceFilteredSkills, visibilityFilter);

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      toggleSkill(id, enabled),
    onMutate: async ({ id, enabled }) => {
      await queryClient.cancelQueries({ queryKey: ["skills"] });
      const previousSkills = queryClient.getQueryData(["skills"]);
      queryClient.setQueryData(["skills"], (old: { skills: { id: string; isEnabled: boolean }[] } | undefined) => {
        if (!old) return old;
        return {
          ...old,
          skills: old.skills.map((skill) =>
            skill.id === id ? { ...skill, isEnabled: enabled } : skill
          ),
        };
      });
      return { previousSkills };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousSkills) {
        queryClient.setQueryData(["skills"], context.previousSkills);
      }
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = compactSkillInput(form);
      if (!payload.name || !payload.content) {
        throw new Error(t("skills.required"));
      }
      return editingId ? updateSkill(editingId, payload) : createSkill(payload);
    },
    onSuccess: () => {
      setForm(emptySkillForm);
      setEditingId(null);
      setError("");
      queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t("skills.saveFailed"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSkill,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["skills"] }),
  });

  const syncMutation = useMutation({
    mutationFn: syncLocalSkills,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["skills"] }),
  });

  const startEdit = (skill: Skill) => {
    setEditingId(skill.id);
    setForm({
      name: skill.name,
      description: skill.description ?? "",
      source: skill.source,
      content: skill.content ?? "",
      version: skill.version ?? "1.0.0",
      visibility: normalizeVisibility(skill.visibility),
    });
    setError("");
  };

  const applyTemplate = (template: SkillTemplate) => {
    setEditingId(null);
    setForm({
      name: template.name,
      description: template.description,
      source: template.source,
      content: template.content,
      version: template.version,
      visibility: "private",
    });
    setError("");
  };

  const sourceLabel = (sourceId: string) => {
    switch (sourceId) {
      case "local":
        return t("skills.sourceLocal");
      case "clawhub":
        return t("skills.sourceClawHub");
      case "github":
        return t("skills.sourceGitHub");
      default:
        return sourceId;
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("skills.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("skills.subtitle")}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Button
            variant={sourceFilter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setSourceFilter("all")}
          >
            {t("skills.sourceAll")}
          </Button>
          {sources.map((source) => (
            <Button
              key={source.id}
              variant={sourceFilter === source.id ? "default" : "outline"}
              size="sm"
              onClick={() => setSourceFilter(source.id)}
            >
              {source.label}
            </Button>
          ))}
          <div className="mx-1 h-8 w-px bg-border" />
          <Button
            variant={visibilityFilter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setVisibilityFilter("all")}
          >
            {t("visibility.all")}
          </Button>
          {visibilityOptions.map((visibility) => (
            <Button
              key={visibility}
              variant={visibilityFilter === visibility ? "default" : "outline"}
              size="sm"
              onClick={() => setVisibilityFilter(visibility)}
            >
              {t(visibilityLabelKey(visibility))}
            </Button>
          ))}
        </div>
        <Button asChild variant="outline">
          <Link href="/skills/install">
            <ArrowRight className="size-4" />
            {t("skills.install")}
          </Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
        >
          <RefreshCw className={syncMutation.isPending ? "size-4 animate-spin" : "size-4"} />
          {t("skills.syncLocal")}
        </Button>
      </div>

      {data?.discovery && (
        <Card>
          <CardContent className="space-y-3 py-3 text-sm text-muted-foreground">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline">
                {t("skills.discoveredLocal")}: {data.discovery.discoveredCount}
              </Badge>
              <Badge variant="outline">
                {t("skills.discoveryRoots")}: {data.discovery.discoveredRoots?.length ?? 0} / {data.discovery.roots.length}
              </Badge>
              <span>
                {t("skills.localSyncSummary")}: {data.discovery.createdCount} / {data.discovery.updatedCount} / {data.discovery.deletedCount} / {data.discovery.skippedCount}
              </span>
            </div>
            <p className="text-xs">{t("skills.discoveryHint")}</p>
            <div className="grid gap-2 md:grid-cols-2">
              {(data.discovery.discoveredRoots ?? []).slice(0, 6).map((root) => (
                <code key={root} className="truncate rounded border border-border bg-muted/30 px-2 py-1 text-xs">
                  {root}
                </code>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {editingId ? t("skills.editSkill") : t("skills.createSkill")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {templates.length > 0 && (
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Sparkles className="size-4 text-muted-foreground" />
                {t("skills.quickCreateTemplates")}
              </div>
              <div className="grid gap-2 md:grid-cols-5">
                {templates.map((template) => (
                  <Button
                    key={template.id}
                    type="button"
                    variant="outline"
                    className="h-auto justify-start px-3 py-2 text-left"
                    onClick={() => applyTemplate(template)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{template.title}</span>
                      <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">
                        {template.description}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("skills.templatesDescription")}
              </p>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="skill-name">{t("common.name")}</Label>
              <Input
                id="skill-name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="safe-review"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="skill-source">{t("skills.source")}</Label>
              <div className="flex flex-wrap gap-2">
                {sources.map((source) => (
                  <Button
                    key={source.id}
                    type="button"
                    variant={form.source === source.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setForm((current) => ({ ...current, source: source.id }))}
                  >
                    {source.label}
                  </Button>
                ))}
              </div>
              <Input
                id="skill-source"
                value={form.source}
                onChange={(event) => setForm((current) => ({ ...current, source: event.target.value }))}
                placeholder="local"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="skill-version">{t("skills.version")}</Label>
              <Input
                id="skill-version"
                value={form.version}
                onChange={(event) => setForm((current) => ({ ...current, version: event.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("common.visibility")}</Label>
            <div className="flex flex-wrap gap-2">
              {visibilityOptions.map((visibility) => (
                <Button
                  key={visibility}
                  type="button"
                  variant={normalizeVisibility(form.visibility) === visibility ? "default" : "outline"}
                  size="sm"
                  onClick={() => setForm((current) => ({ ...current, visibility }))}
                >
                  {t(visibilityLabelKey(visibility))}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {t(visibilityDescriptionKey(normalizeVisibility(form.visibility)))}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="skill-description">{t("common.description")}</Label>
            <Input
              id="skill-description"
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="skill-content">{t("skills.content")}</Label>
            <textarea
              id="skill-content"
              className="min-h-36 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              value={form.content}
              onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
            />
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Eye className="size-4 text-muted-foreground" />
              {t("skills.preview")}
            </div>
            <div className="mb-2 flex flex-wrap gap-2">
              <Badge variant="outline">{form.source || "local"}</Badge>
              <Badge variant="outline">{form.version || "1.0.0"}</Badge>
              <Badge variant="secondary">{t(visibilityLabelKey(normalizeVisibility(form.visibility)))}</Badge>
            </div>
            <pre className="max-h-56 overflow-auto rounded-md bg-background p-3 text-xs">
              {form.content.trim() || t("skills.previewEmpty")}
            </pre>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {editingId ? <Save className="mr-2 size-4" /> : <Plus className="mr-2 size-4" />}
              {saveMutation.isPending ? t("skills.saving") : editingId ? t("skills.saveSkill") : t("skills.createSkill")}
            </Button>
            {editingId && (
              <Button
                variant="outline"
                onClick={() => {
                  setEditingId(null);
                  setForm(emptySkillForm);
                  setError("");
                }}
              >
                {t("common.cancel")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("skills.loading")}
          </CardContent>
        </Card>
      ) : filteredSkills.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Wrench className="size-10 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-medium">{t("skills.emptyTitle")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("skills.emptyDescription")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("skills.source")}</TableHead>
                <TableHead>{t("common.visibility")}</TableHead>
                <TableHead>{t("skills.enabled")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSkills.map((skill) => {
                const isPreviewing = previewSkillId === skill.id;
                return (
                  <Fragment key={skill.id}>
                    <TableRow>
                      <TableCell className="font-medium">
                        <div className="flex flex-col gap-1">
                          <span>{skill.name}</span>
                          {skill.description && (
                            <span className="text-xs text-muted-foreground">{skill.description}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="outline">{sourceLabel(skill.source)}</Badge>
                          <Badge variant="outline">{skill.version ?? "1.0.0"}</Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{t(visibilityLabelKey(normalizeVisibility(skill.visibility)))}</Badge>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={skill.isEnabled}
                          onCheckedChange={(enabled) => toggleMutation.mutate({ id: skill.id, enabled })}
                          disabled={toggleMutation.isPending}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setPreviewSkillId(isPreviewing ? null : skill.id)}
                          >
                            <Eye className="size-4" />
                            <span className="sr-only">{t("skills.preview")}</span>
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => startEdit(skill)}>
                            <Pencil className="size-4" />
                            <span className="sr-only">{t("skills.editSkill")}</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive"
                            onClick={() => {
                              if (window.confirm(t("skills.deleteConfirm"))) {
                                deleteMutation.mutate(skill.id);
                              }
                            }}
                          >
                            <Trash2 className="size-4" />
                            <span className="sr-only">{t("common.delete")}</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {isPreviewing && (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <pre className="max-h-72 overflow-auto rounded-md border bg-muted/20 p-3 text-xs">
                            {skill.content?.trim() || t("skills.previewEmpty")}
                          </pre>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function compactSkillInput(input: SkillInput): SkillInput {
  return {
    name: input.name.trim(),
    content: input.content.trim(),
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    ...(input.source?.trim() ? { source: input.source.trim() } : {}),
    ...(input.version?.trim() ? { version: input.version.trim() } : {}),
    visibility: normalizeVisibility(input.visibility),
  };
}
