"use client";

import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useTrilingual } from "@/hooks/use-trilingual";
import {
  createSkill,
  updateSkill,
  listSkillTemplates,
  type Skill,
  type SkillInput,
} from "@/lib/api";
import {
  normalizeVisibility,
  visibilityLabelKey,
  visibilityOptions,
} from "@/lib/visibility";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  skill: Skill | null;
  onClose: () => void;
}

export function SkillEditor({ skill, onClose }: Props) {
  const { t } = useLanguage();
  const pick = useTrilingual();
  const client = useQueryClient();
  const nameRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const [form, setForm] = useState<SkillInput>(() => ({
    name: skill?.name ?? "",
    description: skill?.description ?? "",
    content: skill?.content ?? "",
    source: skill?.source ?? "local",
    version: skill?.version ?? "1.0.0",
    visibility: normalizeVisibility(skill?.visibility),
  }));
  const [errors, setErrors] = useState<{ name?: string; content?: string }>({});
  const templates = useQuery({
    queryKey: ["skill-templates"],
    queryFn: listSkillTemplates,
    enabled: !skill,
  });
  const save = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        name: form.name.trim(),
        content: form.content.trim(),
        description: form.description?.trim(),
      };
      return skill ? updateSkill(skill.id, payload) : createSkill(payload);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["skills"] });
      onClose();
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    const next = {
      name: form.name.trim() ? undefined : t("skills.fieldRequired"),
      content: form.content.trim() ? undefined : t("skills.fieldRequired"),
    };
    setErrors(next);
    if (next.name) {
      nameRef.current?.focus();
      return;
    }
    if (next.content) {
      contentRef.current?.focus();
      return;
    }
    save.mutate();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent
        className="skills-dialog flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document
            .getElementById(skill ? `skill-open-${skill.id}` : "skill-create")
            ?.focus();
        }}
      >
        <DialogHeader className="shrink-0 border-b border-border/70 p-6">
          <DialogTitle>
            {skill ? t("skills.editSkill") : t("skills.createSkill")}
          </DialogTitle>
        </DialogHeader>
        <form
          aria-label={skill ? t("skills.editSkill") : t("skills.createSkill")}
          className="flex min-h-0 flex-col overflow-hidden"
          onSubmit={submit}
          noValidate
        >
          <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-6">
            {!skill && templates.data?.templates.length ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="skill-template">
                  {pick("起始模板", "起始範本", "Starting template")}
                </Label>
                <select
                  id="skill-template"
                  name="template"
                  defaultValue=""
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  onChange={(event) => {
                    const template = templates.data?.templates.find(
                      (item) => item.id === event.target.value,
                    );
                    if (template) {
                      setForm({ ...template, visibility: "private" });
                      setErrors({});
                    }
                  }}
                >
                  <option value="">
                    {pick("空白 Skill", "空白 Skill", "Blank Skill")}
                  </option>
                  {templates.data.templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.title}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              <Label htmlFor="skill-name">
                {t("common.name")} <span aria-hidden="true">*</span>
              </Label>
              <Input
                ref={nameRef}
                id="skill-name"
                name="name"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
                maxLength={128}
                placeholder="code-review"
                value={form.name}
                onChange={(event) => {
                  setForm({ ...form, name: event.target.value });
                  setErrors({ ...errors, name: undefined });
                }}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? "skill-name-error" : undefined}
              />
              {errors.name ? (
                <p
                  role="alert"
                  id="skill-name-error"
                  className="text-xs text-destructive"
                >
                  {errors.name}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="skill-description">
                {t("common.description")}
              </Label>
              <Input
                id="skill-description"
                name="description"
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="skill-content">
                SKILL.md <span aria-hidden="true">*</span>
                <span className="sr-only"> {t("skills.content")}</span>
              </Label>
              <textarea
                ref={contentRef}
                id="skill-content"
                name="content"
                required
                spellCheck={false}
                className="min-h-64 w-full resize-y rounded-md border border-input bg-muted/20 p-4 font-mono text-sm leading-relaxed focus-visible:outline-2 focus-visible:outline-ring"
                value={form.content}
                onChange={(event) => {
                  setForm({ ...form, content: event.target.value });
                  setErrors({ ...errors, content: undefined });
                }}
                aria-invalid={Boolean(errors.content)}
                aria-describedby={
                  errors.content ? "skill-content-error" : undefined
                }
              />
              {errors.content ? (
                <p
                  role="alert"
                  id="skill-content-error"
                  className="text-xs text-destructive"
                >
                  {errors.content}
                </p>
              ) : null}
            </div>
            <details className="rounded-md border border-border/70 p-3">
              <summary className="cursor-pointer text-sm">
                {pick("版本与可见性", "版本與可見性", "Version & visibility")}
              </summary>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="skill-version">
                    {pick("版本", "版本", "Version")}
                  </Label>
                  <Input
                    id="skill-version"
                    name="version"
                    value={form.version}
                    onChange={(event) =>
                      setForm({ ...form, version: event.target.value })
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="skill-source">{t("skills.source")}</Label>
                  <Input
                    id="skill-source"
                    name="source"
                    value={form.source}
                    onChange={(event) =>
                      setForm({ ...form, source: event.target.value })
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="skill-visibility">
                    {t("common.visibility")}
                  </Label>
                  <select
                    id="skill-visibility"
                    name="visibility"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={form.visibility}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        visibility: normalizeVisibility(event.target.value),
                      })
                    }
                  >
                    {visibilityOptions.map((value) => (
                      <option key={value} value={value}>
                        {t(visibilityLabelKey(value))}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </details>
            {templates.error ? (
              <p role="alert" className="text-xs text-destructive">
                {templates.error.message}
              </p>
            ) : null}
            {save.error ? (
              <p role="alert" className="text-sm text-destructive">
                {save.error.message}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t border-border/70 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="brand" disabled={save.isPending}>
              <Save />
              {save.isPending
                ? t("skills.saving")
                : skill
                  ? t("skills.saveSkill")
                  : t("skills.createSkill")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
