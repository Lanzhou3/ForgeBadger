"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Pencil, Plus, Power, Save, ShieldCheck, Sparkles, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createAgent,
  deleteAgent,
  listAgents,
  listAgentTemplates,
  listModels,
  listProjects,
  updateAgent,
  type Agent,
  type AgentInput,
  type AgentTemplate,
} from "@/lib/api";
import { buildAgentPermissionPreview } from "@/lib/agent-preview";
import { useLanguage } from "@/hooks/use-language";

const emptyAgentForm: AgentInput = {
  name: "",
  description: "",
  projectId: "",
  modelId: "",
  tools: "",
  allowedDirs: "",
  customPrompt: "",
};

export default function AgentsPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AgentInput>(emptyAgentForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: listAgents,
  });
  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
  });
  const { data: modelsData } = useQuery({
    queryKey: ["models"],
    queryFn: listModels,
  });
  const { data: templatesData } = useQuery({
    queryKey: ["agent-templates"],
    queryFn: listAgentTemplates,
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = compactAgentInput(form);
      if (!payload.name) {
        throw new Error(t("agents.nameRequired"));
      }
      return editingId ? updateAgent(editingId, payload) : createAgent(payload);
    },
    onSuccess: () => {
      setForm(emptyAgentForm);
      setEditingId(null);
      setError("");
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t("agents.saveFailed"));
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updateAgent(id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAgent,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
  });

  const agents = data?.agents ?? [];
  const projects = projectsData?.projects ?? [];
  const models = modelsData?.models ?? [];
  const templates = templatesData?.templates ?? [];
  const formPreview = buildAgentPermissionPreview({
    tools: form.tools,
    allowedDirs: form.allowedDirs,
    projectName: form.projectId ? projectName(projects, form.projectId) : t("agents.globalAgent"),
    modelName: form.modelId ? modelName(models, form.modelId) : t("projects.noModel"),
  });

  const startEdit = (agent: Agent) => {
    setEditingId(agent.id);
    setForm({
      name: agent.name,
      description: agent.description ?? "",
      projectId: agent.projectId ?? "",
      modelId: agent.modelId ?? "",
      tools: agent.tools ?? "",
      allowedDirs: agent.allowedDirs ?? "",
      customPrompt: agent.customPrompt ?? "",
    });
    setError("");
  };

  const applyTemplate = (template: AgentTemplate) => {
    setEditingId(null);
    setForm((current) => ({
      ...current,
      name: template.name,
      description: template.description,
      tools: template.tools,
      allowedDirs: template.allowedDirs,
      customPrompt: template.customPrompt,
    }));
    setError("");
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("agents.title")}</h1>
          <p className="mt-1 text-muted-foreground">
            {t("agents.subtitle")}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {editingId ? t("agents.editAgent") : t("agents.createAgent")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {templates.length > 0 && (
            <div className="space-y-2">
              <Label>{t("agents.quickCreateTemplates")}</Label>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className="rounded-md border border-border bg-background p-3 text-left text-sm transition-colors hover:bg-accent/40"
                    onClick={() => applyTemplate(template)}
                    title={t("agents.applyTemplate")}
                  >
                    <div className="flex items-center gap-2 font-medium">
                      <Sparkles className="size-4 text-muted-foreground" />
                      <span className="min-w-0 truncate">{template.name}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {template.description}
                    </p>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("agents.templatesDescription")}
              </p>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="agent-name">{t("common.name")}</Label>
              <Input
                id="agent-name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Code Reviewer"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-project">{t("common.project")}</Label>
              <select
                id="agent-project"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                value={form.projectId}
                onChange={(event) => setForm((current) => ({ ...current, projectId: event.target.value }))}
              >
                <option value="">{t("agents.globalAgent")}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-model">{t("projects.model")}</Label>
              <select
                id="agent-model"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                value={form.modelId}
                onChange={(event) => setForm((current) => ({ ...current, modelId: event.target.value }))}
              >
                <option value="">{t("projects.noModel")}</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-tools">{t("agents.tools")}</Label>
              <Input
                id="agent-tools"
                value={form.tools}
                onChange={(event) => setForm((current) => ({ ...current, tools: event.target.value }))}
                placeholder="Read,Edit,Bash"
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="agent-description">{t("common.description")}</Label>
              <Input
                id="agent-description"
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-dirs">{t("agents.allowedDirs")}</Label>
              <Input
                id="agent-dirs"
                value={form.allowedDirs}
                onChange={(event) => setForm((current) => ({ ...current, allowedDirs: event.target.value }))}
                placeholder="/path/to/project"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-prompt">{t("agents.customPrompt")}</Label>
            <textarea
              id="agent-prompt"
              className="min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              value={form.customPrompt}
              onChange={(event) => setForm((current) => ({ ...current, customPrompt: event.target.value }))}
            />
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="size-4 text-muted-foreground" />
              {t("agents.permissionPreview")}
            </div>
            <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
              <PreviewField label={t("agents.scope")} value={formPreview.scope} />
              <PreviewField label={t("projects.model")} value={formPreview.model} />
              <PreviewList label={t("agents.tools")} emptyLabel={t("agents.noTools")} values={formPreview.tools} />
              <PreviewList label={t("agents.allowedDirs")} emptyLabel={t("agents.noAllowedDirs")} values={formPreview.allowedDirs} />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {editingId ? <Save className="mr-2 size-4" /> : <Plus className="mr-2 size-4" />}
              {saveMutation.isPending ? t("agents.saving") : editingId ? t("agents.saveAgent") : t("agents.createAgent")}
            </Button>
            {editingId && (
              <Button
                variant="outline"
                onClick={() => {
                  setEditingId(null);
                  setForm(emptyAgentForm);
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
            {t("agents.loading")}
          </CardContent>
        </Card>
      ) : agents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Bot className="size-10 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-medium">{t("agents.emptyTitle")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("agents.emptyDescription")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("common.project")}</TableHead>
                <TableHead>{t("projects.model")}</TableHead>
                <TableHead>{t("agents.tools")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => {
                const preview = buildAgentPermissionPreview({
                  tools: agent.tools,
                  allowedDirs: agent.allowedDirs,
                  projectName: projectName(projects, agent.projectId) ?? agent.projectName ?? t("agents.globalAgent"),
                  modelName: modelName(models, agent.modelId) ?? agent.model ?? t("projects.noModel"),
                });
                return (
                  <TableRow key={agent.id}>
                    <TableCell className="font-medium">{agent.name}</TableCell>
                    <TableCell>{preview.scope}</TableCell>
                    <TableCell>{preview.model}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <InlineBadges values={preview.tools} emptyLabel={t("agents.noTools")} />
                        <p className="text-xs text-muted-foreground">
                          {preview.allowedDirs.length > 0
                            ? preview.allowedDirs.join(", ")
                            : t("agents.noAllowedDirs")}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{agent.status ?? "idle"}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => startEdit(agent)}>
                          <Pencil className="size-4" />
                          <span className="sr-only">{t("agents.editAgent")}</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            statusMutation.mutate({
                              id: agent.id,
                              status: agent.status === "disabled" ? "active" : "disabled",
                            })
                          }
                        >
                          <Power className="size-4" />
                          <span className="sr-only">{t("agents.toggleStatus")}</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() => {
                            if (window.confirm(t("agents.deleteConfirm"))) {
                              deleteMutation.mutate(agent.id);
                            }
                          }}
                        >
                          <Trash2 className="size-4" />
                          <span className="sr-only">{t("common.delete")}</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function PreviewField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-medium">{value}</div>
    </div>
  );
}

function PreviewList({ label, emptyLabel, values }: { label: string; emptyLabel: string; values: string[] }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1">
        <InlineBadges values={values} emptyLabel={emptyLabel} />
      </div>
    </div>
  );
}

function InlineBadges({ values, emptyLabel }: { values: string[]; emptyLabel: string }) {
  if (values.length === 0) {
    return <span className="text-xs text-muted-foreground">{emptyLabel}</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {values.map((value) => (
        <Badge key={value} variant="outline">
          {value}
        </Badge>
      ))}
    </div>
  );
}

function compactAgentInput(input: AgentInput): AgentInput {
  return {
    name: input.name.trim(),
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    ...(input.projectId?.trim() ? { projectId: input.projectId.trim() } : {}),
    ...(input.modelId?.trim() ? { modelId: input.modelId.trim() } : {}),
    ...(input.tools?.trim() ? { tools: input.tools.trim() } : {}),
    ...(input.allowedDirs?.trim() ? { allowedDirs: input.allowedDirs.trim() } : {}),
    ...(input.customPrompt?.trim() ? { customPrompt: input.customPrompt.trim() } : {}),
  };
}

function projectName(projects: Array<{ id: string; name: string }>, projectId?: string | null): string | undefined {
  return projects.find((project) => project.id === projectId)?.name;
}

function modelName(models: Array<{ id: string; name: string }>, modelId?: string | null): string | undefined {
  return models.find((model) => model.id === modelId)?.name;
}
