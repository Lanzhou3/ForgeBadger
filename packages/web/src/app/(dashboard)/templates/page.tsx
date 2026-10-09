"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Copy, Download, FileCode2, GitBranch, PackagePlus, Plus, RotateCcw, Save, Trash2, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryState } from "@/components/ui/query-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AdapterSelect } from "@/components/adapter-select";
import { toast } from "@/lib/toast";
import {
  cloneTemplate,
  createTemplate,
  deleteTemplate,
  exportTemplate,
  getTemplate,
  importTemplate,
  importTemplateFromGit,
  installCatalogTemplate,
  listCatalogItems,
  listTemplates,
  listTemplateVersions,
restoreTemplateVersion,
  updateTemplate,
  updateTemplateFile,
  type GitTemplateImportInput,
  type RuntimeAdapterId,
  type Template,
  type TemplatePackage,
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
import { useLanguage, useUiLocale } from "@/hooks/use-language";
import { TemplateSyncPanel } from "@/components/templates/TemplateSyncPanel";

const defaultFilePath = "AGENTS.md";
const defaultTemplateContent = [
  "# {{projectName}}",
  "",
  "Project root: `{{projectRoot}}`",
  "",
  "Follow the repository instructions and keep changes scoped.",
  "",
].join("\n");

class TemplateFileSaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateFileSaveError";
  }
}

export default function TemplatesPage() {
  const { t } = useLanguage();
  const locale = useUiLocale();
  const queryClient = useQueryClient();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateAdapter, setNewTemplateAdapter] = useState<RuntimeAdapterId | "">("");
  const [newTemplateVisibility, setNewTemplateVisibility] = useState<LibraryVisibility>("private");
  const [cloneName, setCloneName] = useState("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editVisibility, setEditVisibility] = useState<LibraryVisibility>("private");
  const [editFilePath, setEditFilePath] = useState(defaultFilePath);
  const [editContent, setEditContent] = useState(defaultTemplateContent);
  const [editBaselineContent, setEditBaselineContent] = useState<string | null>(null);
  const [editBaselineFilePath, setEditBaselineFilePath] = useState<string | null>(null);
  const editorEpochRef = useRef(0);
  const editorContextRef = useRef({ templateId: selectedTemplateId, filePath: editBaselineFilePath, epoch: 0 });
  editorContextRef.current = { templateId: selectedTemplateId, filePath: editBaselineFilePath, epoch: editorEpochRef.current };
  const [loadedDetailsId, setLoadedDetailsId] = useState<string | null>(null);
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(null);
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("all");
  const [templatePackageText, setTemplatePackageText] = useState("");
  const [catalogExpanded, setCatalogExpanded] = useState(false);
  const [gitImportExpanded, setGitImportExpanded] = useState(false);
  const [gitImportUrl, setGitImportUrl] = useState("");
  const [gitImportBranch, setGitImportBranch] = useState("");
  const [gitImportName, setGitImportName] = useState("");
  const [gitImportDescription, setGitImportDescription] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["templates"],
    queryFn: listTemplates,
  });
  const [deletingTemplate, setDeletingTemplate] = useState<Template | null>(null);
  const [restoringVersion, setRestoringVersion] = useState<{ template: Template; versionId: number; version: string } | null>(null);

  const templates = data?.templates ?? [];
  const filteredTemplates = filterByVisibility(templates, visibilityFilter);
  const governedTemplates = filteredTemplates.filter((template) => (template.usageCount ?? 0) > 0);
  const seedTemplates = filteredTemplates.filter((template) => (template.usageCount ?? 0) === 0);

  function renderTemplateItem(template: Template) {
    return (
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
    );
  }
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
        // A template must declare which CLI it targets; no implicit default.
        ...(newTemplateAdapter ? { adapter: newTemplateAdapter } : {}),
        files: [{ filePath: defaultFilePath, content: defaultTemplateContent, fileType: "markdown" }],
      }),
    onSuccess: async ({ template }) => {
      setNotice(t("templates.created"));
      setNewTemplateName("");
      setNewTemplateAdapter("");
      setNewTemplateVisibility("private");
      setSelectedTemplateId(template.id);
      setEditBaselineContent(null);
      setEditBaselineFilePath(null);
      setLoadedDetailsId(null);
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
      setEditBaselineContent(null);
      setEditBaselineFilePath(null);
      setLoadedDetailsId(null);
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
      const saved = { templateId: selectedTemplateId, filePath: editFilePath.trim(), content: editContent, editorEpoch: editorEpochRef.current };
      await updateTemplate(selectedTemplateId, {
        name: editName.trim(),
        description: editDescription.trim(),
        visibility: editVisibility,
      });
      try {
        await updateTemplateFile(saved.templateId, saved.filePath, saved.content);
      } catch (fileError) {
        const message = fileError instanceof Error ? fileError.message : String(fileError);
        throw new TemplateFileSaveError(message);
      }
      return saved;
    },
    onSuccess: async (saved) => {
      setNotice(t("templates.saved"));
      // A late save owns its submitted baseline, but never a newly loaded editor.
      if (editorContextRef.current.templateId === saved.templateId && editorEpochRef.current === saved.editorEpoch) {
        setEditBaselineContent(saved.content);
        setEditBaselineFilePath(saved.filePath);
      }
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
      await queryClient.invalidateQueries({ queryKey: ["template", saved.templateId] });
      const context = editorContextRef.current;
      if (context.templateId !== saved.templateId || context.epoch === saved.editorEpoch) return;
      // A reload or restore can supersede this save. Read the current persisted
      // file while preserving the new editor's draft and selection.
      const refreshed = await queryClient.fetchQuery({ queryKey: ["template", saved.templateId], queryFn: () => getTemplate(saved.templateId), staleTime: 0 });
      if (editorContextRef.current.templateId !== context.templateId || editorEpochRef.current !== context.epoch) return;
      const file = refreshed.template.files?.find(file => file.filePath === context.filePath);
      if (file) setEditBaselineContent(file.content);
    },
    onError: (error) => {
      if (error instanceof TemplateFileSaveError) {
        toast.error(t("templates.saveFileFailed"));
      }
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

  function downloadTemplatePackage() {
    const content = templatePackageText.trim();
    if (!content) return;
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selectedTemplate?.name ?? "template"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const importMutation = useMutation({
    mutationFn: () => {
      let parsed: TemplatePackage;
      try {
        parsed = JSON.parse(templatePackageText) as TemplatePackage;
      } catch {
        throw new Error(t("templates.importInvalidJson"));
      }
      return importTemplate(parsed);
    },
    onSuccess: async ({ template }) => {
      setNotice(t("templates.imported"));
      setSelectedTemplateId(template.id);
      setEditBaselineContent(null);
      setEditBaselineFilePath(null);
      setLoadedDetailsId(null);
      setEditName(template.name);
      setEditDescription(template.description ?? "");
      setEditVisibility(normalizeVisibility(template.visibility));
      setTemplatePackageText("");
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
  });

  const installCatalogMutation = useMutation({
    mutationFn: installCatalogTemplate,
    onSuccess: async ({ template }) => {
      setNotice(t("templates.catalogInstalled"));
      setSelectedTemplateId(template.id);
      setEditBaselineContent(null);
      setEditBaselineFilePath(null);
      setLoadedDetailsId(null);
      setEditName(template.name);
      setEditDescription(template.description ?? "");
      setEditVisibility(normalizeVisibility(template.visibility));
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
  });

  const importGitMutation = useMutation({
    mutationFn: () => {
      const input: GitTemplateImportInput = { url: gitImportUrl.trim() };
      const branch = gitImportBranch.trim();
      if (branch) input.branch = branch;
      const name = gitImportName.trim();
      if (name) input.name = name;
      const description = gitImportDescription.trim();
      if (description) input.description = description;
      return importTemplateFromGit(input);
    },
    onSuccess: async (result) => {
      setNotice(t("templates.gitImported"));
      setGitImportUrl("");
      setGitImportBranch("");
      setGitImportName("");
      setGitImportDescription("");
      setSelectedTemplateId(result.templateId);
      setEditBaselineContent(null);
      setEditBaselineFilePath(null);
      setLoadedDetailsId(null);
      setEditName(result.name);
      setEditDescription("");
      setEditVisibility("private");
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
        editorEpochRef.current++;
        setEditFilePath(firstFile.filePath);
        setEditContent(firstFile.content);
        setEditBaselineContent(firstFile.content);
        setEditBaselineFilePath(firstFile.filePath);
      }
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
      await queryClient.invalidateQueries({ queryKey: ["template", selectedTemplateId] });
      await queryClient.invalidateQueries({ queryKey: ["template", selectedTemplateId, "versions"] });
    },
  });

  function isEditorDirty() {
    if (!selectedTemplate) return false;
    if (editContent !== editBaselineContent) return true;
    if (editFilePath.trim() !== editBaselineFilePath) return true;
    if (editName.trim() !== (selectedTemplate.name ?? "")) return true;
    if (editDescription.trim() !== (selectedTemplate.description ?? "")) return true;
    return editVisibility !== normalizeVisibility(selectedTemplate.visibility);
  }

  function applySelectTemplate(templateId: string) {
    editorEpochRef.current++;
    const template = templates.find((current) => current.id === templateId);
    setSelectedTemplateId(templateId);
    setEditName(template?.name ?? "");
    setEditDescription(template?.description ?? "");
    setEditVisibility(normalizeVisibility(template?.visibility));
    setEditFilePath(defaultFilePath);
    setEditContent("");
    setEditBaselineContent(null);
    setEditBaselineFilePath(null);
    setLoadedDetailsId(null);
    setTemplatePackageText("");
    setNotice(null);
  }

  function selectTemplate(templateId: string) {
    if (templateId === selectedTemplateId) return;
    if (!isEditorDirty()) {
      applySelectTemplate(templateId);
      return;
    }
    setPendingSelectId(templateId);
  }

  function confirmDiscardAndSwitch() {
    const templateId = pendingSelectId;
    setPendingSelectId(null);
    if (templateId) applySelectTemplate(templateId);
  }

  function syncSelectedFile() {
    const file = selectedDetails?.template.files?.find((current) => current.filePath === editFilePath)
      ?? selectedDetails?.template.files?.[0];
    if (!file) return;
    editorEpochRef.current++;
    setEditFilePath(file.filePath);
    setEditContent(file.content);
    setEditBaselineContent(file.content);
    setEditBaselineFilePath(file.filePath);
  }

  useEffect(() => {
    if (!selectedTemplateId || !selectedDetails) return;
    if (loadedDetailsId === selectedTemplateId) return;
    editorEpochRef.current++;
    const file = selectedDetails.template.files?.[0];
    setEditFilePath(file?.filePath ?? defaultFilePath);
    setEditContent(file?.content ?? "");
    setEditBaselineContent(file ? file.content : "");
    setEditBaselineFilePath(file?.filePath ?? defaultFilePath);
    setLoadedDetailsId(selectedTemplateId);
  }, [selectedTemplateId, selectedDetails, loadedDetailsId]);

  const saveDisabled =
    selectedIsBuiltin ||
    saveMutation.isPending ||
    editBaselineContent === null ||
    !isEditorDirty();

  const currentError =
    createMutation.error ??
    cloneMutation.error ??
    (saveMutation.error instanceof TemplateFileSaveError ? null : saveMutation.error) ??
    deleteMutation.error ??
    exportMutation.error ??
    importMutation.error ??
    installCatalogMutation.error ??
    importGitMutation.error ??
    restoreMutation.error;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t("templates.title")}</h1>
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
                  <Label>{t("common.aiTool")}</Label>
                  <AdapterSelect
                    ariaLabel={t("common.aiTool")}
                    className="h-10 w-full"
                    value={newTemplateAdapter}
                    onValueChange={(id) => setNewTemplateAdapter(id)}
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
                <Button type="submit" className="w-full" disabled={createMutation.isPending || !newTemplateAdapter}>
                  <Plus className="size-4" />
                  {createMutation.isPending ? t("templates.creating") : t("templates.createCustom")}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-6 pt-6 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onClick={() => setCatalogExpanded((current) => !current)}
              aria-expanded={catalogExpanded}
              aria-label={t("templates.catalogInstall")}
            >
              <div className="flex items-center gap-2">
                <PackagePlus className="size-4" />
                <span className="text-base font-semibold">{t("templates.catalogInstall")}</span>
              </div>
              <ChevronDown
                className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                  catalogExpanded ? "rotate-180" : ""
                }`}
              />
            </button>
            <CardContent className="space-y-2 pt-4">
              <p className="text-sm text-muted-foreground">{t("templates.catalogInstallDescription")}</p>
              {catalogExpanded && (catalogTemplates.length === 0 ? (
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
              ))}
            </CardContent>
          </Card>

          <Card>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-6 pt-6 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onClick={() => setGitImportExpanded((current) => !current)}
              aria-expanded={gitImportExpanded}
              aria-label={t("templates.gitImport")}
            >
              <div className="flex items-center gap-2">
                <GitBranch className="size-4" />
                <span className="text-base font-semibold">{t("templates.gitImport")}</span>
              </div>
              <ChevronDown
                className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                  gitImportExpanded ? "rotate-180" : ""
                }`}
              />
            </button>
            <CardContent className="space-y-2 pt-4">
              <p className="text-sm text-muted-foreground">{t("templates.gitImportDescription")}</p>
              {gitImportExpanded && (
                <form
                  className="space-y-3"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    importGitMutation.mutate();
                  }}
                >
                  <div className="space-y-2">
                    <Label htmlFor="git-import-url">{t("templates.gitImportUrl")}</Label>
                    <Input
                      id="git-import-url"
                      value={gitImportUrl}
                      onChange={(event) => setGitImportUrl(event.target.value)}
                      placeholder="https://github.com/your-org/ai-cli-config"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="git-import-branch">{t("templates.gitImportBranch")}</Label>
                    <Input
                      id="git-import-branch"
                      value={gitImportBranch}
                      onChange={(event) => setGitImportBranch(event.target.value)}
                      placeholder="main"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="git-import-name">{t("common.name")}</Label>
                    <Input
                      id="git-import-name"
                      value={gitImportName}
                      onChange={(event) => setGitImportName(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="git-import-description">{t("common.description")}</Label>
                    <Input
                      id="git-import-description"
                      value={gitImportDescription}
                      onChange={(event) => setGitImportDescription(event.target.value)}
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={!gitImportUrl.trim() || importGitMutation.isPending}
                  >
                    <GitBranch className="size-4" />
                    {importGitMutation.isPending ? t("templates.gitImporting") : t("templates.gitImport")}
                  </Button>
                </form>
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
              <QueryState
                isLoading={isLoading}
                isError={isError}
                isEmpty={filteredTemplates.length === 0}
                onRetry={() => void refetch()}
                loading={
                  <div className="py-6 text-center text-sm text-muted-foreground">{t("templates.loading")}</div>
                }
                empty={
                  <div className="py-6 text-center text-sm text-muted-foreground">{t("templates.emptyTitle")}</div>
                }
              >
                <div className="space-y-3">
                  {governedTemplates.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 px-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {t("templates.governedTitle")}
                        </span>
                        <Badge variant="secondary">{governedTemplates.length}</Badge>
                      </div>
                      {governedTemplates.map((template) => renderTemplateItem(template))}
                    </div>
                  )}
                  {seedTemplates.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 px-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {t("templates.seedTitle")}
                        </span>
                        <Badge variant="secondary">{seedTemplates.length}</Badge>
                      </div>
                      {seedTemplates.map((template) => renderTemplateItem(template))}
                    </div>
                  )}
                </div>
              </QueryState>
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
                  variant="outline"
                  disabled={!templatePackageText.trim()}
                  onClick={downloadTemplatePackage}
                >
                  <Download className="size-4" />
                  {t("templates.download")}
                </Button>
                <Button
                  type="button"
                  className="col-span-2"
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
                <TemplateSyncPanel templateId={selectedTemplate.id} />
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
                      if (selectedTemplate) setDeletingTemplate(selectedTemplate);
                    }}
                  >
                    <Trash2 className="size-4" />
                    {t("common.delete")}
                  </Button>
                  <Button
                    disabled={saveDisabled}
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
                                    if (selectedTemplate) {
                                      setRestoringVersion({
                                        template: selectedTemplate,
                                        versionId: version.id,
                                        version: version.version,
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
                              {version.action} · {new Date(version.createdAt).toLocaleString(locale)}
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

      <Dialog
        open={pendingSelectId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSelectId(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">{t("templates.discardChangesTitle")}</DialogTitle>
            <DialogDescription>{t("templates.discardChangesDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingSelectId(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="destructive" onClick={confirmDiscardAndSwitch}>
              {t("templates.discardChangesConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deletingTemplate !== null}
        destructive
        pending={deleteMutation.isPending}
        title={t("templates.deleteConfirmTitle")}
        description={
          deletingTemplate
            ? [
                t("templates.deleteConfirmNamed").replace("{name}", deletingTemplate.name),
                (deletingTemplate.usageCount ?? 0) > 0
                  ? t("templates.deleteInUseWarning").replace(
                      "{count}",
                      String(deletingTemplate.usageCount)
                    )
                  : "",
              ]
                .filter(Boolean)
                .join(" ")
            : ""
        }
        confirmLabel={t("common.delete")}
        onOpenChange={(open) => {
          if (!open) setDeletingTemplate(null);
        }}
        onConfirm={() => {
          if (deletingTemplate) deleteMutation.mutate(deletingTemplate.id);
          setDeletingTemplate(null);
        }}
      />
      <ConfirmDialog
        open={restoringVersion !== null}
        pending={restoreMutation.isPending}
        title={t("templates.restoreConfirmTitle")}
        description={
          restoringVersion
            ? t("templates.restoreConfirmNamed")
                .replace("{name}", restoringVersion.template.name)
                .replace("{version}", restoringVersion.version)
            : ""
        }
        onOpenChange={(open) => {
          if (!open) setRestoringVersion(null);
        }}
        onConfirm={() => {
          if (restoringVersion) {
            restoreMutation.mutate({
              templateId: restoringVersion.template.id,
              versionId: restoringVersion.versionId,
            });
          }
          setRestoringVersion(null);
        }}
      />
    </div>
  );
}
