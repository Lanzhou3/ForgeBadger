"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, Eye, FileCode2, PackagePlus, Plus, RotateCcw, Save, Trash2, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  cloneTemplate,
  createTemplate,
  createTemplateFromProject,
  deleteTemplate,
  exportTemplate,
  getTemplate,
  importTemplate,
  installCatalogTemplate,
  listCatalogItems,
  listProjects,
  listTemplates,
  listTemplateVersions,
  previewTemplateFromProject,
  type TemplateFromProjectPreview,
  restoreTemplateVersion,
  type TemplatePackage,
  updateTemplate,
  updateTemplateFile,
} from "@/lib/api";
import {
  filterByVisibility,
  normalizeVisibility,
  visibilityDescriptionKey,
  visibilityLabelKey,
  visibilityOptions,
  type LibraryVisibility,
  type VisibilityFilter,
} from "@/lib/visibility";
import { useLanguage } from "@/hooks/use-language";

const defaultFilePath = "CLAUDE.md";
const defaultTemplateContent = [
  "# {{projectName}}",
  "",
  "Project root: `{{projectRoot}}`",
  "",
  "Follow the repository instructions and keep changes scoped.",
  "",
].join("\n");

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function TemplatesPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateVisibility, setNewTemplateVisibility] = useState<LibraryVisibility>("private");
  const [cloneName, setCloneName] = useState("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editVisibility, setEditVisibility] = useState<LibraryVisibility>("private");
  const [editFilePath, setEditFilePath] = useState(defaultFilePath);
  const [editContent, setEditContent] = useState(defaultTemplateContent);
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("all");
  const [templatePackageText, setTemplatePackageText] = useState("");
  const [sourceProjectId, setSourceProjectId] = useState("");
  const [sourceTemplateName, setSourceTemplateName] = useState("");
  const [sourceTemplateDescription, setSourceTemplateDescription] = useState("");
  const [sourcePreview, setSourcePreview] = useState<TemplateFromProjectPreview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["templates"],
    queryFn: listTemplates,
  });

  const templates = data?.templates ?? [];
  const filteredTemplates = filterByVisibility(templates, visibilityFilter);
  const { data: projectsData, isLoading: projectsLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
  });
  const projects = projectsData?.projects ?? [];
  const sourceProject = projects.find((project) => project.id === sourceProjectId);
  const { data: catalogItemsData } = useQuery({
    queryKey: ["catalog-items"],
    queryFn: listCatalogItems,
  });
  const catalogTemplates = (catalogItemsData?.items ?? []).filter((item) => item.itemType === "template");
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId),
    [selectedTemplateId, templates]
  );
  const selectedIsBuiltin = !!selectedTemplate?.isBuiltin || !!selectedTemplate?.builtin;

  const { data: selectedDetails } = useQuery({
    queryKey: ["template", selectedTemplateId],
    queryFn: () => getTemplate(selectedTemplateId as string),
    enabled: !!selectedTemplateId,
  });

  const { data: versionData } = useQuery({
    queryKey: ["template", selectedTemplateId, "versions"],
    queryFn: () => listTemplateVersions(selectedTemplateId as string),
    enabled: !!selectedTemplateId && !selectedIsBuiltin,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createTemplate({
        name: newTemplateName.trim(),
        visibility: newTemplateVisibility,
        files: [{ filePath: defaultFilePath, content: defaultTemplateContent, fileType: "markdown" }],
      }),
    onSuccess: async ({ template }) => {
      setNotice(t("templates.created"));
      setNewTemplateName("");
      setNewTemplateVisibility("private");
      setSelectedTemplateId(template.id);
      setEditName(template.name);
      setEditDescription(template.description ?? "");
      setEditVisibility(normalizeVisibility(template.visibility));
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
  });

  const cloneMutation = useMutation({
    mutationFn: (templateId: string) =>
      cloneTemplate(templateId, cloneName.trim() || `${selectedTemplate?.name ?? "Template"} Copy`),
    onSuccess: async ({ template }) => {
      setNotice(t("templates.cloned"));
      setCloneName("");
      setSelectedTemplateId(template.id);
      setEditName(template.name);
      setEditDescription(template.description ?? "");
      setEditVisibility(normalizeVisibility(template.visibility));
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplateId) {
        throw new Error("Template is required");
      }
      await updateTemplate(selectedTemplateId, {
        name: editName.trim(),
        description: editDescription.trim(),
        visibility: editVisibility,
      });
      return updateTemplateFile(selectedTemplateId, editFilePath.trim(), editContent);
    },
    onSuccess: async () => {
      setNotice(t("templates.saved"));
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
      await queryClient.invalidateQueries({ queryKey: ["template", selectedTemplateId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTemplate,
    onSuccess: async () => {
      setNotice(t("templates.deleted"));
      setSelectedTemplateId(null);
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
  });

  const exportMutation = useMutation({
    mutationFn: (templateId: string) => exportTemplate(templateId),
    onSuccess: ({ templatePackage }) => {
      setTemplatePackageText(JSON.stringify(templatePackage, null, 2));
      setNotice(t("templates.exported"));
    },
  });

  const importMutation = useMutation({
    mutationFn: () => importTemplate(JSON.parse(templatePackageText) as TemplatePackage),
    onSuccess: async ({ template }) => {
      setNotice(t("templates.imported"));
      setSelectedTemplateId(template.id);
      setEditName(template.name);
      setEditDescription(template.description ?? "");
      setEditVisibility(normalizeVisibility(template.visibility));
      setTemplatePackageText("");
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
  });

  const previewFromProjectMutation = useMutation({
    mutationFn: () => {
      if (!sourceProjectId) {
        throw new Error("Project is required");
      }
      return previewTemplateFromProject(sourceProjectId);
    },
    onSuccess: (preview) => {
      setNotice(null);
      setSourcePreview(preview);
      if (!sourceTemplateName.trim()) {
        setSourceTemplateName(`${preview.project.name} Template`);
      }
    },
  });

  const createFromProjectMutation = useMutation({
    mutationFn: () => {
      if (!sourceProjectId) {
        throw new Error("Project is required");
      }
      if (!sourcePreview || sourcePreview.project.id !== sourceProjectId) {
        throw new Error("Preview is required");
      }
      return createTemplateFromProject({
        projectId: sourceProjectId,
        name: sourceTemplateName.trim() || `${sourceProject?.name ?? "Project"} Template`,
        ...(sourceTemplateDescription.trim() ? { description: sourceTemplateDescription.trim() } : {}),
        filePaths: sourcePreview.files.map((file) => file.filePath),
      });
    },
    onSuccess: async ({ template }) => {
      setNotice(t("templates.createdFromProject"));
      setSelectedTemplateId(template.id);
      setEditName(template.name);
      setEditDescription(template.description ?? "");
      setEditVisibility(normalizeVisibility(template.visibility));
      setSourcePreview(null);
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
  });

  const installCatalogMutation = useMutation({
    mutationFn: installCatalogTemplate,
    onSuccess: async ({ template }) => {
      setNotice(t("templates.catalogInstalled"));
      setSelectedTemplateId(template.id);
      setEditName(template.name);
      setEditDescription(template.description ?? "");
      setEditVisibility(normalizeVisibility(template.visibility));
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: ({ templateId, versionId }: { templateId: string; versionId: number }) =>
      restoreTemplateVersion(templateId, versionId),
    onSuccess: async ({ template }) => {
      const firstFile = template.files?.[0];
      setNotice(t("templates.restored"));
      setEditName(template.name);
      setEditDescription(template.description ?? "");
      setEditVisibility(normalizeVisibility(template.visibility));
      if (firstFile) {
        setEditFilePath(firstFile.filePath);
        setEditContent(firstFile.content);
      }
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
      await queryClient.invalidateQueries({ queryKey: ["template", selectedTemplateId] });
      await queryClient.invalidateQueries({ queryKey: ["template", selectedTemplateId, "versions"] });
    },
  });

  function selectTemplate(templateId: string) {
    const template = templates.find((current) => current.id === templateId);
    setSelectedTemplateId(templateId);
    setEditName(template?.name ?? "");
    setEditDescription(template?.description ?? "");
    setEditVisibility(normalizeVisibility(template?.visibility));
    setEditFilePath(defaultFilePath);
    setEditContent("");
    setTemplatePackageText("");
    setNotice(null);
  }

  function selectSourceProject(projectId: string) {
    setSourceProjectId(projectId);
    setSourcePreview(null);
    const project = projects.find((current) => current.id === projectId);
    if (project && !sourceTemplateName.trim()) {
      setSourceTemplateName(`${project.name} Template`);
    }
  }

  function syncSelectedFile() {
    const file = selectedDetails?.template.files?.find((current) => current.filePath === editFilePath)
      ?? selectedDetails?.template.files?.[0];
    if (!file) return;
    setEditFilePath(file.filePath);
    setEditContent(file.content);
  }

  const currentError =
    createMutation.error ??
    cloneMutation.error ??
    saveMutation.error ??
    deleteMutation.error ??
    exportMutation.error ??
    importMutation.error ??
    previewFromProjectMutation.error ??
    createFromProjectMutation.error ??
    installCatalogMutation.error ??
    restoreMutation.error;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("templates.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("templates.subtitle")}</p>
      </div>

      {notice && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      )}
      {currentError instanceof Error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {currentError.message}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Plus className="size-4" />
                {t("templates.createCustom")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-3"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  createMutation.mutate();
                }}
              >
                <Label htmlFor="new-template-name">{t("common.name")}</Label>
                <Input
                  id="new-template-name"
                  value={newTemplateName}
                  onChange={(event) => setNewTemplateName(event.target.value)}
                  required
                />
                <div className="space-y-2">
                  <Label>{t("common.visibility")}</Label>
                  <div className="flex flex-wrap gap-2">
                    {visibilityOptions.map((visibility) => (
                      <Button
                        key={visibility}
                        type="button"
                        size="sm"
                        variant={newTemplateVisibility === visibility ? "default" : "outline"}
                        onClick={() => setNewTemplateVisibility(visibility)}
                      >
                        {t(visibilityLabelKey(visibility))}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t(visibilityDescriptionKey(newTemplateVisibility))}
                  </p>
                </div>
                <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                  <Plus className="size-4" />
                  {createMutation.isPending ? t("templates.creating") : t("templates.createCustom")}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Eye className="size-4" />
                {t("templates.createFromProject")}
              </CardTitle>
              <CardDescription>{t("templates.createFromProjectDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="source-project">{t("templates.sourceProject")}</Label>
                <select
                  id="source-project"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  value={sourceProjectId}
                  disabled={projectsLoading}
                  onChange={(event) => selectSourceProject(event.target.value)}
                >
                  <option value="">{t("templates.sourceProjectPlaceholder")}</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="source-template-name">{t("templates.sourceTemplateName")}</Label>
                <Input
                  id="source-template-name"
                  value={sourceTemplateName}
                  onChange={(event) => setSourceTemplateName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="source-template-description">{t("templates.sourceTemplateDescription")}</Label>
                <Input
                  id="source-template-description"
                  value={sourceTemplateDescription}
                  onChange={(event) => setSourceTemplateDescription(event.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!sourceProjectId || previewFromProjectMutation.isPending}
                  onClick={() => previewFromProjectMutation.mutate()}
                >
                  <Eye className="size-4" />
                  {previewFromProjectMutation.isPending
                    ? t("templates.previewing")
                    : t("templates.previewExtracted")}
                </Button>
                <Button
                  type="button"
                  disabled={
                    !sourceProjectId ||
                    !sourcePreview ||
                    sourcePreview.project.id !== sourceProjectId ||
                    sourcePreview.files.length === 0 ||
                    createFromProjectMutation.isPending
                  }
                  onClick={() => createFromProjectMutation.mutate()}
                >
                  <PackagePlus className="size-4" />
                  {createFromProjectMutation.isPending
                    ? t("templates.creatingFromProject")
                    : t("templates.createFromProjectAction")}
                </Button>
              </div>
              {sourcePreview && (
                <div className="rounded-md border bg-background p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{t("templates.extractedFiles")}</span>
                    <Badge variant="outline">{formatBytes(sourcePreview.totalBytes)}</Badge>
                  </div>
                  {sourcePreview.files.length === 0 ? (
                    <p className="mt-3 text-xs text-muted-foreground">{t("templates.noExtractedFiles")}</p>
                  ) : (
                    <div className="mt-3 max-h-40 space-y-2 overflow-auto pr-1">
                      {sourcePreview.files.map((file) => (
                        <div
                          key={file.filePath}
                          className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-xs"
                        >
                          <span className="truncate font-mono">{file.filePath}</span>
                          <span className="shrink-0 text-muted-foreground">{formatBytes(file.sizeBytes)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PackagePlus className="size-4" />
                {t("templates.catalogInstall")}
              </CardTitle>
              <CardDescription>{t("templates.catalogInstallDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {catalogTemplates.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {t("templates.catalogEmpty")}
                </div>
              ) : (
                catalogTemplates.map((item) => (
                  <div key={item.id} className="rounded-md border bg-background p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{item.name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {item.sourceId} · {item.version ?? "1.0.0"}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={installCatalogMutation.isPending}
                        onClick={() => installCatalogMutation.mutate(item.id)}
                      >
                        <PackagePlus className="size-3" />
                        {installCatalogMutation.isPending
                          ? t("templates.installing")
                          : t("templates.install")}
                      </Button>
                    </div>
                    {item.description && (
                      <p className="mt-2 text-xs text-muted-foreground">{item.description}</p>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("templates.available")}</CardTitle>
              <CardDescription>{t("templates.availableDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap gap-2 pb-2">
                <Button
                  type="button"
                  size="sm"
                  variant={visibilityFilter === "all" ? "default" : "outline"}
                  onClick={() => setVisibilityFilter("all")}
                >
                  {t("visibility.all")}
                </Button>
                {visibilityOptions.map((visibility) => (
                  <Button
                    key={visibility}
                    type="button"
                    size="sm"
                    variant={visibilityFilter === visibility ? "default" : "outline"}
                    onClick={() => setVisibilityFilter(visibility)}
                  >
                    {t(visibilityLabelKey(visibility))}
                  </Button>
                ))}
              </div>
              {isLoading ? (
                <div className="py-6 text-center text-sm text-muted-foreground">{t("templates.loading")}</div>
              ) : filteredTemplates.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">{t("templates.emptyTitle")}</div>
              ) : (
                filteredTemplates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
                    onClick={() => selectTemplate(template.id)}
                  >
                    <span className="font-medium">{template.name}</span>
                    <span className="flex flex-wrap justify-end gap-2">
                      {(template.isBuiltin || template.builtin) && (
                        <Badge variant="secondary">{t("templates.builtin")}</Badge>
                      )}
                      <Badge variant="outline">{t(visibilityLabelKey(normalizeVisibility(template.visibility)))}</Badge>
                    </span>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("templates.importExport")}</CardTitle>
              <CardDescription>{t("templates.importExportDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Label htmlFor="template-package">{t("templates.packageJson")}</Label>
              <textarea
                id="template-package"
                className="min-h-40 w-full rounded-md border border-input bg-background p-3 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                value={templatePackageText}
                onChange={(event) => setTemplatePackageText(event.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!selectedTemplateId || exportMutation.isPending}
                  onClick={() => selectedTemplateId && exportMutation.mutate(selectedTemplateId)}
                >
                  <Download className="size-4" />
                  {t("templates.export")}
                </Button>
                <Button
                  type="button"
                  disabled={!templatePackageText.trim() || importMutation.isPending}
                  onClick={() => importMutation.mutate()}
                >
                  <Upload className="size-4" />
                  {t("templates.import")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FileCode2 className="size-5" />
                  {selectedTemplate?.name ?? t("templates.selectTemplate")}
                </CardTitle>
                <CardDescription>{t("templates.editorDescription")}</CardDescription>
              </div>
              {selectedTemplate && (
                <div className="flex gap-2">
                  <Input
                    className="h-8 w-48"
                    value={cloneName}
                    onChange={(event) => setCloneName(event.target.value)}
                    placeholder={t("templates.cloneName")}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => cloneMutation.mutate(selectedTemplate.id)}
                    disabled={cloneMutation.isPending}
                  >
                    <Copy className="size-4" />
                    {t("templates.clone")}
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!selectedTemplate ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-sm text-muted-foreground">
                <FileCode2 className="mb-4 size-10" />
                {t("templates.selectTemplate")}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="template-name">{t("common.name")}</Label>
                    <Input
                      id="template-name"
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      disabled={selectedIsBuiltin}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="template-description">{t("common.description")}</Label>
                    <Input
                      id="template-description"
                      value={editDescription}
                      onChange={(event) => setEditDescription(event.target.value)}
                      disabled={selectedIsBuiltin}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("common.visibility")}</Label>
                    <div className="flex flex-wrap gap-2">
                      {visibilityOptions.map((visibility) => (
                        <Button
                          key={visibility}
                          type="button"
                          size="sm"
                          variant={editVisibility === visibility ? "default" : "outline"}
                          disabled={selectedIsBuiltin}
                          onClick={() => setEditVisibility(visibility)}
                        >
                          {t(visibilityLabelKey(visibility))}
                        </Button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t(visibilityDescriptionKey(editVisibility))}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-2">
                      <Label htmlFor="template-file">{t("templates.filePath")}</Label>
                      <Input
                        id="template-file"
                        value={editFilePath}
                        onChange={(event) => setEditFilePath(event.target.value)}
                        disabled={selectedIsBuiltin}
                      />
                    </div>
                    <Button type="button" variant="outline" onClick={syncSelectedFile}>
                      {t("templates.loadFile")}
                    </Button>
                  </div>
                  <textarea
                    className="min-h-80 w-full rounded-md border border-input bg-background p-3 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    value={editContent}
                    onChange={(event) => setEditContent(event.target.value)}
                    disabled={selectedIsBuiltin}
                    placeholder={t("templates.fileContent")}
                  />
                </div>

                <div className="flex justify-between gap-2">
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    disabled={selectedIsBuiltin || deleteMutation.isPending}
                    onClick={() => {
                      if (selectedTemplateId && window.confirm(t("templates.deleteConfirm"))) {
                        deleteMutation.mutate(selectedTemplateId);
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                    {t("common.delete")}
                  </Button>
                  <Button
                    disabled={selectedIsBuiltin || saveMutation.isPending}
                    onClick={() => saveMutation.mutate()}
                  >
                    <Save className="size-4" />
                    {saveMutation.isPending ? t("templates.saving") : t("templates.save")}
                  </Button>
                </div>

                {!selectedIsBuiltin && (
                  <div className="rounded-md border bg-muted/20 p-3">
                    <h3 className="text-sm font-medium">{t("templates.versionHistory")}</h3>
                    {(versionData?.versions ?? []).length === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">{t("templates.noVersions")}</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {versionData?.versions.map((version) => (
                          <div key={version.id} className="rounded-md border bg-background p-2 text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-medium">{version.name}</span>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline">{version.version}</Badge>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={!selectedTemplateId || restoreMutation.isPending}
                                  onClick={() => {
                                    if (
                                      selectedTemplateId &&
                                      window.confirm(t("templates.restoreConfirm"))
                                    ) {
                                      restoreMutation.mutate({
                                        templateId: selectedTemplateId,
                                        versionId: version.id,
                                      });
                                    }
                                  }}
                                >
                                  <RotateCcw className="size-3" />
                                  {restoreMutation.isPending ? t("templates.restoring") : t("templates.restore")}
                                </Button>
                              </div>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {version.action} · {new Date(version.createdAt).toLocaleString()}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
