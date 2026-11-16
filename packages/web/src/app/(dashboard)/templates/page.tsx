"use client";

import Link from "next/link";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ChevronDown,
  Copy,
  Download,
  FileCode2,
  GitBranch,
  History,
  LockKeyhole,
  MoreHorizontal,
  PackagePlus,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";

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
  normalizeVisibility,
  visibilityLabelKey,
  visibilityOptions,
  type LibraryVisibility,
} from "@/lib/visibility";
import { useLanguage, useUiLocale } from "@/hooks/use-language";
import { useTrilingual } from "@/hooks/use-trilingual";
import { getCliBrand } from "@/lib/cli-brand";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { TemplateLibrary } from "@/components/templates/TemplateLibrary";
import { TemplateFileEditor } from "@/components/templates/TemplateFileEditor";
import "@/components/templates/template-workspace.css";
import { TemplateSyncPanel } from "@/components/templates/TemplateSyncPanel";

type LibraryAction =
  | "create"
  | "catalog"
  | "git"
  | "package"
  | "clone"
  | "metadata";

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
  const pick = useTrilingual();
  const locale = useUiLocale();
  const queryClient = useQueryClient();
  const discardReturnFocusRef = useRef<HTMLElement | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateAdapter, setNewTemplateAdapter] = useState<
    RuntimeAdapterId | ""
  >("");
  const [newTemplateVisibility, setNewTemplateVisibility] =
    useState<LibraryVisibility>("private");
  const [cloneName, setCloneName] = useState("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editVisibility, setEditVisibility] =
    useState<LibraryVisibility>("private");
  const [editFilePath, setEditFilePath] = useState(defaultFilePath);
  const [editContent, setEditContent] = useState(defaultTemplateContent);
  const [editBaselineContent, setEditBaselineContent] = useState<string | null>(
    null,
  );
  const [editBaselineFilePath, setEditBaselineFilePath] = useState<
    string | null
  >(null);
  const editorEpochRef = useRef(0);
  const editorContextRef = useRef({
    templateId: selectedTemplateId,
    filePath: editBaselineFilePath,
    epoch: 0,
  });
  editorContextRef.current = {
    templateId: selectedTemplateId,
    filePath: editBaselineFilePath,
    epoch: editorEpochRef.current,
  };
  const [loadedDetailsId, setLoadedDetailsId] = useState<string | null>(null);
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(null);
  const [panel, setPanel] = useState("files");
  const [pendingFilePath, setPendingFilePath] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<LibraryAction | null>(
    null,
  );
  const [templatePackageText, setTemplatePackageText] = useState("");
  const [libraryAction, setLibraryAction] = useState<LibraryAction | null>(
    null,
  );
  const [gitImportUrl, setGitImportUrl] = useState("");
  const [gitImportBranch, setGitImportBranch] = useState("");
  const [gitImportName, setGitImportName] = useState("");
  const [gitImportDescription, setGitImportDescription] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["templates"],
    queryFn: listTemplates,
  });
  const [deletingTemplate, setDeletingTemplate] = useState<Template | null>(
    null,
  );
  const [restoringVersion, setRestoringVersion] = useState<{
    template: Template;
    versionId: number;
    version: string;
  } | null>(null);

  const templates = data?.templates ?? [];

  const {
    data: catalogItemsData,
    error: catalogError,
    isPending: catalogLoading,
    refetch: refetchCatalog,
  } = useQuery({
    queryKey: ["catalog-items"],
    queryFn: listCatalogItems,
    enabled: libraryAction === "catalog",
  });
  const catalogTemplates = (catalogItemsData?.items ?? []).filter(
    (item) => item.itemType === "template",
  );
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId),
    [selectedTemplateId, templates],
  );
  const selectedIsBuiltin =
    !!selectedTemplate?.isBuiltin || !!selectedTemplate?.builtin;

  const {
    data: selectedDetails,
    error: detailsError,
    isPending: detailsLoading,
    refetch: refetchDetails,
  } = useQuery({
    queryKey: ["template", selectedTemplateId],
    queryFn: () => getTemplate(selectedTemplateId as string),
    enabled: !!selectedTemplateId,
  });

  const {
    data: versionData,
    error: versionsError,
    isPending: versionsLoading,
    refetch: refetchVersions,
  } = useQuery({
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
        files: [
          {
            filePath:
              newTemplateAdapter === "claude" ? "CLAUDE.md" : defaultFilePath,
            content: defaultTemplateContent,
            fileType: "markdown",
          },
        ],
      }),
    onSuccess: async ({ template }) => {
      setNotice(t("templates.created"));
      setLibraryAction((current) => (current === "create" ? null : current));
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
      cloneTemplate(
        templateId,
        cloneName.trim() || `${selectedTemplate?.name ?? "Template"} Copy`,
      ),
    onSuccess: async ({ template }) => {
      setNotice(t("templates.cloned"));
      setLibraryAction(null);
      setPanel("files");
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
      const saved = {
        templateId: selectedTemplateId,
        filePath: editFilePath.trim(),
        content: editContent,
        editorEpoch: editorEpochRef.current,
      };
      await updateTemplate(selectedTemplateId, {
        name: editName.trim(),
        description: editDescription.trim(),
        visibility: editVisibility,
      });
      try {
        if (
          saved.content !== editBaselineContent ||
          saved.filePath !== editBaselineFilePath
        ) {
          await updateTemplateFile(
            saved.templateId,
            saved.filePath,
            saved.content,
          );
        }
      } catch (fileError) {
        const message =
          fileError instanceof Error ? fileError.message : String(fileError);
        throw new TemplateFileSaveError(message);
      }
      return saved;
    },
    onSuccess: async (saved) => {
      setLibraryAction((current) => (current === "metadata" ? null : current));
      setNotice(t("templates.saved"));
      // A late save owns its submitted baseline, but never a newly loaded editor.
      if (
        editorContextRef.current.templateId === saved.templateId &&
        editorEpochRef.current === saved.editorEpoch
      ) {
        setEditBaselineContent(saved.content);
        setEditBaselineFilePath(saved.filePath);
      }
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
      await queryClient.invalidateQueries({
        queryKey: ["template", saved.templateId],
      });
      const context = editorContextRef.current;
      if (
        context.templateId !== saved.templateId ||
        context.epoch === saved.editorEpoch
      )
        return;
      // A reload or restore can supersede this save. Read the current persisted
      // file while preserving the new editor's draft and selection.
      const refreshed = await queryClient.fetchQuery({
        queryKey: ["template", saved.templateId],
        queryFn: () => getTemplate(saved.templateId),
        staleTime: 0,
      });
      if (
        editorContextRef.current.templateId !== context.templateId ||
        editorEpochRef.current !== context.epoch
      )
        return;
      const file = refreshed.template.files?.find(
        (file) => file.filePath === context.filePath,
      );
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
      setLibraryAction((current) => (current === "package" ? null : current));
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
      setLibraryAction((current) => (current === "catalog" ? null : current));
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
      setLibraryAction((current) => (current === "git" ? null : current));
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
    mutationFn: ({
      templateId,
      versionId,
    }: {
      templateId: string;
      versionId: number;
    }) => restoreTemplateVersion(templateId, versionId),
    onSuccess: async ({ template }) => {
      const firstFile = template.files?.[0];
      setPanel("files");
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
      await queryClient.invalidateQueries({
        queryKey: ["template", selectedTemplateId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["template", selectedTemplateId, "versions"],
      });
    },
  });

  function isEditorDirty() {
    if (!selectedTemplate || editBaselineContent === null) return false;
    if (editContent !== editBaselineContent) return true;
    if (editFilePath.trim() !== editBaselineFilePath) return true;
    if (editName.trim() !== (selectedTemplate.name ?? "")) return true;
    if (editDescription.trim() !== (selectedTemplate.description ?? ""))
      return true;
    return editVisibility !== normalizeVisibility(selectedTemplate.visibility);
  }

  function applySelectTemplate(templateId: string) {
    editorEpochRef.current++;
    const template = templates.find((current) => current.id === templateId);
    setSelectedTemplateId(templateId);
    setPanel("files");
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

  function openLibraryAction(action: LibraryAction) {
    if (action !== "metadata" && isEditorDirty()) {
      setPendingAction(action);
      return;
    }
    setLibraryAction(action);
  }

  function confirmDiscardAndSwitch() {
    const templateId = pendingSelectId;
    const filePath = pendingFilePath;
    const action = pendingAction;
    setPendingSelectId(null);
    setPendingFilePath(null);
    setPendingAction(null);
    if (templateId) applySelectTemplate(templateId);
    else if (filePath) loadFile(filePath);
    else if (action) {
      syncSelectedFile();
      setEditName(selectedTemplate?.name ?? "");
      setEditDescription(selectedTemplate?.description ?? "");
      setEditVisibility(normalizeVisibility(selectedTemplate?.visibility));
      setLibraryAction(action);
    }
  }

  function loadFile(filePath: string) {
    const file = selectedDetails?.template.files?.find(
      (file) => file.filePath === filePath,
    );
    if (!file) return;
    editorEpochRef.current++;
    setEditFilePath(file.filePath);
    setEditContent(file.content);
    setEditBaselineContent(file.content);
    setEditBaselineFilePath(file.filePath);
  }

  function selectFile(filePath: string) {
    if (filePath === editBaselineFilePath && filePath === editFilePath) return;
    if (
      editBaselineContent !== null &&
      (editContent !== editBaselineContent ||
        editFilePath.trim() !== editBaselineFilePath)
    ) {
      setPendingFilePath(filePath);
      return;
    }
    loadFile(filePath);
  }

  function requestLoadFile() {
    const file =
      selectedDetails?.template.files?.find(
        (current) => current.filePath === editFilePath,
      ) ?? selectedDetails?.template.files?.[0];
    if (!file) return;
    if (editBaselineContent !== null && editContent !== editBaselineContent) {
      setPendingFilePath(file.filePath);
      return;
    }
    loadFile(file.filePath);
  }

  function syncSelectedFile() {
    const file =
      selectedDetails?.template.files?.find(
        (current) => current.filePath === editFilePath,
      ) ?? selectedDetails?.template.files?.[0];
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
    (saveMutation.error instanceof TemplateFileSaveError
      ? null
      : saveMutation.error) ??
    deleteMutation.error ??
    restoreMutation.error;

  return (
    <div className="template-workspace flex h-full flex-col gap-5 p-6">
      <header className="flex shrink-0 items-center justify-between gap-4">
        <h1 className="flex items-baseline gap-3 text-xl font-semibold tracking-tight">
          {t("templates.title")}
          <span className="text-base font-normal tabular-nums text-muted-foreground">
            {data ? templates.length : ""}
          </span>
        </h1>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button id="template-import" size="sm" variant="outline">
                <Upload />
                {pick("导入", "匯入", "Import")}
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onSelect={() => {
                    importGitMutation.reset();
                    openLibraryAction("git");
                  }}
                >
                  <GitBranch />
                  {t("templates.gitImport")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    importMutation.reset();
                    exportMutation.reset();
                    openLibraryAction("package");
                  }}
                >
                  <Upload />
                  {t("templates.importExport")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    installCatalogMutation.reset();
                    openLibraryAction("catalog");
                  }}
                >
                  <PackagePlus />
                  {t("templates.catalogInstall")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            id="template-create"
            size="sm"
            variant="brand"
            onClick={() => {
              createMutation.reset();
              openLibraryAction("create");
            }}
          >
            <Plus />
            {pick("新建模板", "新增範本", "New template")}
          </Button>
        </div>
      </header>
      {notice ? (
        <div
          role="status"
          className="flex shrink-0 items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs"
        >
          <span>{notice}</span>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={t("common.close")}
            onClick={() => setNotice(null)}
          >
            <X />
          </Button>
        </div>
      ) : null}
      {!libraryAction && currentError instanceof Error ? (
        <p
          role="alert"
          className="shrink-0 rounded-md border border-destructive/30 p-3 text-sm text-destructive"
        >
          {currentError.message}
        </p>
      ) : null}
      <div className="template-workbench min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
        <TemplateLibrary
          templates={templates}
          selectedId={selectedTemplateId}
          onSelect={selectTemplate}
          loading={isLoading}
          error={isError && !data}
          onRetry={() => void refetch()}
        />
        {!selectedTemplate ? (
          <div className="flex flex-col items-center justify-center gap-4 text-muted-foreground">
            <FileCode2 className="size-9" />
            <h2 className="text-sm font-medium">
              {t("templates.selectTemplate")}
            </h2>
          </div>
        ) : (
          <section
            key={selectedTemplate.id}
            aria-label={selectedTemplate.name}
            className="template-detail-enter flex min-h-0 min-w-0 flex-col"
          >
            <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border/70 px-5 py-4">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold">
                  {selectedTemplate.name}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>v{selectedTemplate.version ?? "1.0.0"}</span>
                  {selectedTemplate.adapter ? (
                    <>
                      <span>·</span>
                      <span>{getCliBrand(selectedTemplate.adapter).label}</span>
                    </>
                  ) : null}
                  <span>·</span>
                  <span>
                    {t(
                      visibilityLabelKey(
                        normalizeVisibility(selectedTemplate.visibility),
                      ),
                    )}
                  </span>
                  {selectedIsBuiltin ? (
                    <>
                      <LockKeyhole className="size-3" />
                      <span>{t("templates.builtin")}</span>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="sm" variant="ghost" asChild>
                  <Link href="/projects">
                    {pick("在项目中使用", "在專案中使用", "Use in project")}
                    <ArrowUpRight />
                  </Link>
                </Button>
                <Button
                  id="template-clone"
                  size="sm"
                  variant={selectedIsBuiltin ? "brand" : "outline"}
                  disabled={cloneMutation.isPending}
                  onClick={() => {
                    cloneMutation.reset();
                    setCloneName(`${selectedTemplate.name} Copy`);
                    openLibraryAction("clone");
                  }}
                >
                  <Copy />
                  {t("templates.clone")}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={pick(
                        "模板操作",
                        "範本操作",
                        "Template actions",
                      )}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        onSelect={() => {
                          exportMutation.reset();
                          setLibraryAction("package");
                          exportMutation.mutate(selectedTemplate.id);
                        }}
                      >
                        <Download />
                        {pick("导出 JSON", "匯出 JSON", "Export JSON")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={selectedIsBuiltin || deleteMutation.isPending}
                        variant="destructive"
                        onSelect={() => setDeletingTemplate(selectedTemplate)}
                      >
                        <Trash2 />
                        {t("common.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <Tabs
              value={panel}
              onValueChange={setPanel}
              className="min-h-0 flex-1 gap-0"
              activationMode="manual"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-border/70 px-4">
                <TabsList
                  variant="line"
                  aria-label={pick("模板详情", "範本詳情", "Template details")}
                  className="h-11 gap-3"
                >
                  <TabsTrigger value="files">
                    {pick("文件", "檔案", "Files")}
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {selectedDetails?.template.files?.length ?? ""}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="projects">
                    {pick("关联项目", "關聯專案", "Projects")}
                    {selectedTemplate.usageCount ? (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {selectedTemplate.usageCount}
                      </span>
                    ) : null}
                  </TabsTrigger>
                  {!selectedIsBuiltin ? (
                    <TabsTrigger value="versions">
                      {pick("版本历史", "版本歷史", "Versions")}
                    </TabsTrigger>
                  ) : null}
                </TabsList>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={selectedIsBuiltin}
                  onClick={() => {
                    saveMutation.reset();
                    openLibraryAction("metadata");
                  }}
                  aria-label={pick(
                    "模板属性",
                    "範本屬性",
                    "Template properties",
                  )}
                  title={pick("模板属性", "範本屬性", "Template properties")}
                >
                  <Settings2 />
                </Button>
              </div>
              <TabsContent value="files" className="flex min-h-0 flex-col">
                <TemplateFileEditor
                  files={selectedDetails?.template.files ?? []}
                  filePath={editFilePath}
                  baselinePath={editBaselineFilePath}
                  content={editContent}
                  readonly={selectedIsBuiltin}
                  dirty={isEditorDirty()}
                  loading={detailsLoading}
                  error={detailsError}
                  onRetry={() => void refetchDetails()}
                  saveDisabled={saveDisabled}
                  saving={saveMutation.isPending}
                  onFile={selectFile}
                  onPath={setEditFilePath}
                  onContent={setEditContent}
                  onLoad={requestLoadFile}
                  onSave={() => saveMutation.mutate()}
                />
              </TabsContent>
              <TabsContent
                value="projects"
                className="min-h-0 overflow-y-auto p-5"
              >
                <TemplateSyncPanel
                  key={selectedTemplate.id}
                  templateId={selectedTemplate.id}
                  showEmpty
                  draftPending={isEditorDirty()}
                  onReturnToFiles={() => setPanel("files")}
                />
              </TabsContent>
              <TabsContent
                value="versions"
                className="min-h-0 overflow-y-auto p-5"
              >
                {versionsError ? (
                  <div role="alert" className="text-sm text-destructive">
                    {versionsError.message}
                    <Button variant="link" onClick={() => refetchVersions()}>
                      {t("common.retry")}
                    </Button>
                  </div>
                ) : versionsLoading ? (
                  <p
                    role="status"
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    {t("common.loading")}
                  </p>
                ) : !versionData?.versions.length ? (
                  <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
                    <History className="size-7" />
                    <p className="text-sm">{t("templates.noVersions")}</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border/70 rounded-lg border border-border">
                    {versionData.versions.map((version) => (
                      <div
                        key={version.id}
                        className="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <span>{version.name}</span>
                            <span className="font-mono text-xs text-muted-foreground">
                              v{version.version}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {version.action} ·{" "}
                            {new Date(version.createdAt).toLocaleString(locale)}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={restoreMutation.isPending}
                          onClick={() =>
                            setRestoringVersion({
                              template: selectedTemplate,
                              versionId: version.id,
                              version: version.version,
                            })
                          }
                        >
                          <RotateCcw />
                          {t("templates.restore")}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </section>
        )}
      </div>

      <TemplateActionDialog
        title={t("templates.createCustom")}
        open={libraryAction === "create"}
        onOpenChange={(open) => {
          if (!open && !createMutation.isPending) setLibraryAction(null);
        }}
        error={createMutation.error}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            createMutation.mutate();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-template-name">{t("common.name")} *</Label>
            <Input
              id="new-template-name"
              name="name"
              value={newTemplateName}
              onChange={(event) => setNewTemplateName(event.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-template-adapter">{t("common.aiTool")}</Label>
            <AdapterSelect
              id="new-template-adapter"
              ariaLabel={t("common.aiTool")}
              className="h-10 w-full"
              value={newTemplateAdapter}
              onValueChange={setNewTemplateAdapter}
              placeholder={pick("选择 CLI", "選擇 CLI", "Choose a CLI")}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="sr-only">{t("common.visibility")}</span>
            <Label htmlFor="new-template-visibility">
              {t("common.visibility")}
            </Label>
            <select
              id="new-template-visibility"
              name="visibility"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={newTemplateVisibility}
              onChange={(event) =>
                setNewTemplateVisibility(
                  normalizeVisibility(event.target.value),
                )
              }
            >
              {visibilityOptions.map((value) => (
                <option key={value} value={value}>
                  {t(visibilityLabelKey(value))}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="submit"
            variant="brand"
            disabled={createMutation.isPending || !newTemplateAdapter}
          >
            <Plus />
            {createMutation.isPending
              ? t("templates.creating")
              : t("templates.createCustom")}
          </Button>
        </form>
      </TemplateActionDialog>
      <TemplateActionDialog
        title={t("templates.catalogInstall")}
        fallbackFocusId="template-import"
        open={libraryAction === "catalog"}
        onOpenChange={(open) => {
          if (!open && !installCatalogMutation.isPending)
            setLibraryAction(null);
        }}
        error={installCatalogMutation.error}
      >
        {catalogError ? (
          <div role="alert" className="text-sm text-destructive">
            {catalogError.message}
            <Button variant="link" onClick={() => refetchCatalog()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : catalogLoading ? (
          <p
            role="status"
            className="py-8 text-center text-sm text-muted-foreground"
          >
            {t("common.loading")}
          </p>
        ) : !catalogTemplates.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("templates.catalogEmpty")}
          </p>
        ) : (
          <div className="divide-y divide-border/70 rounded-md border border-border/70">
            {catalogTemplates.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-medium">{item.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.sourceId} · v{item.version ?? "1.0.0"}
                  </p>
                  {item.description ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.description}
                    </p>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={installCatalogMutation.isPending}
                  onClick={() => installCatalogMutation.mutate(item.id)}
                >
                  <PackagePlus />
                  {installCatalogMutation.isPending
                    ? t("templates.installing")
                    : t("templates.install")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </TemplateActionDialog>
      <TemplateActionDialog
        title={t("templates.gitImport")}
        fallbackFocusId="template-import"
        open={libraryAction === "git"}
        onOpenChange={(open) => {
          if (!open && !importGitMutation.isPending) setLibraryAction(null);
        }}
        error={importGitMutation.error}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            importGitMutation.mutate();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="git-import-url">
              {t("templates.gitImportUrl")} *
            </Label>
            <Input
              id="git-import-url"
              name="url"
              type="url"
              required
              spellCheck={false}
              autoCapitalize="none"
              value={gitImportUrl}
              onChange={(event) => setGitImportUrl(event.target.value)}
              placeholder="https://github.com/your-org/ai-cli-config"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="git-import-branch">
              {t("templates.gitImportBranch")}
            </Label>
            <Input
              id="git-import-branch"
              name="branch"
              value={gitImportBranch}
              onChange={(event) => setGitImportBranch(event.target.value)}
              placeholder="main"
            />
          </div>
          <details className="rounded-md border border-border/70 p-3">
            <summary className="cursor-pointer text-sm">
              {pick(
                "自定义名称与描述",
                "自訂名稱與描述",
                "Custom name & description",
              )}
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              <Label htmlFor="git-import-name">{t("common.name")}</Label>
              <Input
                id="git-import-name"
                name="name"
                value={gitImportName}
                onChange={(event) => setGitImportName(event.target.value)}
              />
              <Label htmlFor="git-import-description">
                {t("common.description")}
              </Label>
              <Input
                id="git-import-description"
                name="description"
                value={gitImportDescription}
                onChange={(event) =>
                  setGitImportDescription(event.target.value)
                }
              />
            </div>
          </details>
          <Button
            type="submit"
            variant="brand"
            disabled={importGitMutation.isPending}
          >
            <GitBranch />
            {importGitMutation.isPending
              ? t("templates.gitImporting")
              : t("templates.gitImport")}
          </Button>
        </form>
      </TemplateActionDialog>
      <TemplateActionDialog
        title={t("templates.importExport")}
        fallbackFocusId="template-import"
        open={libraryAction === "package"}
        onOpenChange={(open) => {
          if (!open && !importMutation.isPending && !exportMutation.isPending)
            setLibraryAction(null);
        }}
        error={importMutation.error ?? exportMutation.error}
      >
        <Label htmlFor="template-package">{t("templates.packageJson")}</Label>
        <textarea
          id="template-package"
          name="package"
          className="min-h-60 w-full resize-y rounded-md border border-input bg-muted/20 p-3 font-mono text-xs focus-visible:outline-2 focus-visible:outline-ring"
          value={templatePackageText}
          onChange={(event) => setTemplatePackageText(event.target.value)}
          spellCheck={false}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            disabled={!selectedTemplateId || exportMutation.isPending}
            onClick={() =>
              selectedTemplateId && exportMutation.mutate(selectedTemplateId)
            }
          >
            <Download />
            {t("templates.export")}
          </Button>
          <Button
            variant="outline"
            disabled={!templatePackageText.trim()}
            onClick={downloadTemplatePackage}
          >
            <Download />
            {t("templates.download")}
          </Button>
          <Button
            variant="brand"
            disabled={!templatePackageText.trim() || importMutation.isPending}
            onClick={() => importMutation.mutate()}
          >
            <Upload />
            {t("templates.import")}
          </Button>
        </div>
      </TemplateActionDialog>
      <TemplateActionDialog
        title={pick("克隆模板", "複製範本", "Clone template")}
        open={libraryAction === "clone"}
        onOpenChange={(open) => {
          if (!open && !cloneMutation.isPending) setLibraryAction(null);
        }}
        error={cloneMutation.error}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (selectedTemplate) cloneMutation.mutate(selectedTemplate.id);
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="template-clone-name">
              {t("templates.cloneName")}
            </Label>
            <Input
              id="template-clone-name"
              name="name"
              required
              value={cloneName}
              onChange={(event) => setCloneName(event.target.value)}
              placeholder={t("templates.cloneName")}
            />
          </div>
          <Button
            type="submit"
            variant="brand"
            disabled={cloneMutation.isPending}
          >
            <Copy />
            {t("templates.clone")}
          </Button>
        </form>
      </TemplateActionDialog>
      <TemplateActionDialog
        title={pick("模板属性", "範本屬性", "Template properties")}
        open={libraryAction === "metadata"}
        onOpenChange={(open) => {
          if (!open && !saveMutation.isPending) setLibraryAction(null);
        }}
        error={
          saveMutation.error instanceof TemplateFileSaveError
            ? null
            : saveMutation.error
        }
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            saveMutation.mutate();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="template-name">{t("common.name")}</Label>
            <Input
              id="template-name"
              name="name"
              required
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="template-description">
              {t("common.description")}
            </Label>
            <Input
              id="template-description"
              name="description"
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="template-visibility">
              {t("common.visibility")}
            </Label>
            <select
              id="template-visibility"
              name="visibility"
              value={editVisibility}
              onChange={(event) =>
                setEditVisibility(normalizeVisibility(event.target.value))
              }
              className="rounded-md border border-input bg-background p-2 text-sm"
            >
              {visibilityOptions.map((value) => (
                <option key={value} value={value}>
                  {t(visibilityLabelKey(value))}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="brand" disabled={saveDisabled}>
            <Save />
            {saveMutation.isPending
              ? t("templates.saving")
              : t("templates.save")}
          </Button>
        </form>
      </TemplateActionDialog>

      <Dialog
        open={
          pendingSelectId !== null ||
          pendingFilePath !== null ||
          pendingAction !== null
        }
        onOpenChange={(open) => {
          if (!open) {
            setPendingSelectId(null);
            setPendingFilePath(null);
            setPendingAction(null);
          }
        }}
      >
        <DialogContent
          className="template-dialog sm:max-w-md"
          onOpenAutoFocus={() => {
            discardReturnFocusRef.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            discardReturnFocusRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("templates.discardChangesTitle")}</DialogTitle>
            <DialogDescription>
              {pendingFilePath
                ? pick(
                    "未保存的文件修改将丢失。",
                    "未儲存的檔案修改將遺失。",
                    "Unsaved file changes will be lost.",
                  )
                : pick(
                    "继续后，未保存的修改将丢失。",
                    "繼續後，未儲存的修改將遺失。",
                    "Continuing will discard unsaved changes.",
                  )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPendingSelectId(null);
                setPendingFilePath(null);
                setPendingAction(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmDiscardAndSwitch}>
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
                t("templates.deleteConfirmNamed").replace(
                  "{name}",
                  deletingTemplate.name,
                ),
                (deletingTemplate.usageCount ?? 0) > 0
                  ? t("templates.deleteInUseWarning").replace(
                      "{count}",
                      String(deletingTemplate.usageCount),
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
          if (restoringVersion)
            restoreMutation.mutate({
              templateId: restoringVersion.template.id,
              versionId: restoringVersion.versionId,
            });
          setRestoringVersion(null);
        }}
      />
    </div>
  );
}

interface TemplateActionDialogProps {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  error: Error | null;
  children: ReactNode;
  fallbackFocusId?: string;
}

function TemplateActionDialog({
  title,
  open,
  onOpenChange,
  error,
  children,
  fallbackFocusId = "template-create",
}: TemplateActionDialogProps) {
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="template-dialog max-h-[85dvh] overflow-y-auto sm:max-w-xl"
        onOpenAutoFocus={() =>
          setReturnFocus(
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null,
          )
        }
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus?.isConnected) returnFocus.focus();
          else document.getElementById(fallbackFocusId)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ) : null}
        <div className="flex flex-col gap-4">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
