"use client";
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  adoptBuiltinSkill,
  copilotSkillsKey,
  getCopilotSkill,
  getSkillRevision,
  listCopilotSkills,
  listSkillRevisions,
  rollbackCopilotSkill,
  setCopilotSkillEnabled,
  updateCopilotSkill,
  type CopilotSkill,
  type CopilotSkillDetail,
  type ExtensionFile,
} from "@/lib/copilot-extensions-api";
import { validateSkillFiles } from "@/lib/copilot-skill-files";
import { CopilotSkillImport, SkillFilePicker } from "./CopilotSkillImport";
import { SkillUpdateComparison } from "./SkillUpdateComparison";
import { CopilotEmptyState } from "./copilot-empty-state";
import { useExtensionsCopy } from "./extensions-copy";

export function CopilotSkillsPanel() {
  const copy = useExtensionsCopy();
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<CopilotSkill | null>(null);
  const skills = useQuery({ queryKey: copilotSkillsKey, queryFn: listCopilotSkills, retry: false });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{copy.skillsHelp}</p>
        <Button size="sm" onClick={() => setImporting(true)}>
          <Plus className="size-4" />
          {copy.importSkill}
        </Button>
      </div>
      {skills.isPending ? (
        <p>{copy.loading}</p>
      ) : skills.isError ? (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{copy.loadError}</p>
          <Button size="sm" variant="outline" onClick={() => void skills.refetch()}>{copy.retry}</Button>
        </div>
      ) : !skills.data?.skills.length ? (
        <CopilotEmptyState icon={BookOpen} title={copy.emptySkills} description={copy.skillsHelp} />
      ) : (
        skills.data.skills.map((skill) => <SkillCard key={skill.id} skill={skill} onOpen={() => setSelected(skill)} />)
      )}
      <Dialog open={importing} onOpenChange={setImporting}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{copy.importSkill}</DialogTitle>
            <DialogDescription>{copy.skillsHelp}</DialogDescription>
          </DialogHeader>
          {importing && <CopilotSkillImport onDone={() => setImporting(false)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{selected?.name}</DialogTitle>
            <DialogDescription>{copy.detail}</DialogDescription>
          </DialogHeader>
          {selected && <SkillDetails id={selected.id} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WarningNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function SkillState({ skill }: { skill: CopilotSkill }) {
  const copy = useExtensionsCopy();
  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline">{skill.kind === "builtin-playbook" ? copy.playbook : copy.imported}</Badge>
        <Badge variant="secondary">{skill.isEnabled ? (skill.available ? copy.enabled : copy.effectiveUnavailable) : copy.disabled}</Badge>
        <Badge variant="outline">v{skill.version}</Badge>
        {skill.customized && <Badge variant="outline">{copy.customized}</Badge>}
      </div>
      {!skill.compatible && <WarningNote>{copy.incompatible}: {skill.incompatibilityReasons.join("; ")}</WarningNote>}
      {skill.reviewRequired && <WarningNote>{copy.review}: v{skill.reviewedBuiltinVersion ?? skill.version} → v{skill.currentVersion}</WarningNote>}
      {skill.isEnabled && !skill.available && !skill.reviewRequired && skill.compatible && <WarningNote>{copy.unavailable}: {skill.unavailableReason}</WarningNote>}
      {!skill.reviewRequired && skill.customized && skill.reviewedBuiltinVersion && (
        <p className="text-muted-foreground">{copy.reviewedAgainst}: v{skill.reviewedBuiltinVersion}</p>
      )}
      {skill.requiredTools.length > 0 && <p className="break-all text-muted-foreground">{copy.dependencies}: {skill.requiredTools.join(", ")}</p>}
    </div>
  );
}

function SkillCard({ skill, onOpen }: { skill: CopilotSkill; onOpen: () => void }) {
  const copy = useExtensionsCopy();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function toggle(enabled: boolean) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await setCopilotSkillEnabled(skill.id, enabled, skill.revisionId);
      await client.invalidateQueries({ queryKey: copilotSkillsKey });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="forgebadger-animate-in space-y-3 rounded-lg border border-border bg-card p-4 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="flex items-center gap-2 font-medium">
            <BookOpen className="size-4 shrink-0 text-brand" />
            <span className="break-all">{skill.name}</span>
          </h2>
          <p className="text-sm text-muted-foreground">{skill.description}</p>
        </div>
        <Switch
          aria-label={skill.name}
          checked={skill.isEnabled}
          disabled={busy || !skill.editable || (!skill.isEnabled && (!skill.compatible || skill.reviewRequired))}
          onCheckedChange={(enabled) => void toggle(enabled)}
        />
      </div>
      <SkillState skill={skill} />
      <p className="break-all text-xs text-muted-foreground">{copy.source}: {skill.source.url ?? skill.source.label ?? skill.source.kind}</p>
      <Button size="sm" variant="outline" onClick={onOpen}>{copy.detail}</Button>
      {error && <p role="alert" className="text-sm text-destructive">{copy.error}</p>}
    </section>
  );
}

function SkillDetails({ id }: { id: string }) {
  const copy = useExtensionsCopy();
  const detail = useQuery({ queryKey: [...copilotSkillsKey, id], queryFn: () => getCopilotSkill(id), retry: false });
  if (detail.isPending) return <p>{copy.loading}</p>;
  if (detail.isError || !detail.data) {
    return (
      <div role="alert" className="space-y-2 text-sm text-destructive">
        <p>{copy.loadError}</p>
        <Button size="sm" variant="outline" onClick={() => void detail.refetch()}>{copy.retry}</Button>
      </div>
    );
  }
  return <SkillEditor key={detail.data.skill.revisionId} skill={detail.data.skill} />;
}

function SkillEditor({ skill }: { skill: CopilotSkillDetail }) {
  const copy = useExtensionsCopy();
  const client = useQueryClient();
  const [files, setFiles] = useState<ExtensionFile[]>(skill.files);
  const [path, setPath] = useState("SKILL.md");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  async function save(review = false) {
    if (busy || (review && !acknowledged)) return;
    setError(null);
    try {
      validateSkillFiles(files);
    } catch {
      setError(copy.fileError);
      return;
    }
    setBusy(true);
    try {
      await updateCopilotSkill(skill.id, { expectedRevisionId: skill.revisionId, files, ...(review ? { reviewedVersion: skill.currentVersion } : {}) });
      await client.invalidateQueries({ queryKey: copilotSkillsKey });
    } catch {
      setError(copy.error);
    } finally {
      setBusy(false);
    }
  }

  async function adopt() {
    if (busy || !skill.bundled) return;
    setBusy(true);
    setError(null);
    try {
      await adoptBuiltinSkill(skill.id, skill.revisionId, skill.bundled.version);
      await client.invalidateQueries({ queryKey: copilotSkillsKey });
    } catch {
      setError(copy.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <SkillState skill={skill} />
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>{copy.files}: {files.length}</span>
        <span>{copy.revision}: {skill.revisionId}</span>
      </div>
      {skill.reviewRequired && skill.bundled && (
        <SkillUpdateComparison
          currentFiles={files}
          bundled={skill.bundled}
          busy={busy}
          editable={skill.editable}
          acknowledged={acknowledged}
          onAcknowledge={setAcknowledged}
          onAdopt={() => void adopt()}
          onKeep={() => void save(true)}
        />
      )}
      <div className="space-y-1 text-sm">
        <span>{copy.files}</span>
        <Select value={path} onValueChange={setPath}>
          <SelectTrigger aria-label={copy.files} className="h-9 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {files.map((file) => (
              <SelectItem key={file.path} value={file.path}>{file.path}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="break-all font-mono">{path}</span>
        <Textarea
          className="min-h-64 font-mono text-xs"
          value={files.find((file) => file.path === path)?.content ?? ""}
          disabled={busy || !skill.editable}
          onChange={(event) => {
            setAcknowledged(false);
            setFiles((current) => current.map((file) => file.path === path ? { ...file, content: event.target.value } : file));
          }}
        />
      </label>
      {skill.editable && (
        <>
          <SkillFilePicker
            disabled={busy}
            onFiles={(next) => {
              setAcknowledged(false);
              setFiles(next);
              setPath("SKILL.md");
            }}
          />
          <p className="text-xs text-muted-foreground">{copy.importHelp}</p>
          {skill.kind === "builtin-playbook" && <p className="text-xs text-muted-foreground">{copy.builtinReview}</p>}
          <Button size="sm" disabled={busy} onClick={() => void save()}>{busy ? copy.refreshing : copy.saveSkill}</Button>
        </>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="border-t border-border/70 pt-3">
        <Button size="sm" variant="outline" onClick={() => setHistoryOpen((open) => !open)}>{copy.history}</Button>
        {historyOpen && <SkillHistory skill={skill} />}
      </div>
    </div>
  );
}

function SkillHistory({ skill }: { skill: CopilotSkill }) {
  const copy = useExtensionsCopy();
  const [preview, setPreview] = useState<string | null>(null);
  const history = useQuery({ queryKey: [...copilotSkillsKey, skill.id, "revisions"], queryFn: () => listSkillRevisions(skill.id), retry: false });
  return (
    <div className="mt-3 space-y-3">
      {history.isPending ? (
        <p>{copy.loading}</p>
      ) : history.isError ? (
        <div role="alert">
          <p className="text-sm text-destructive">{copy.loadError}</p>
          <Button size="sm" variant="outline" onClick={() => void history.refetch()}>{copy.retry}</Button>
        </div>
      ) : !history.data?.revisions.length ? (
        <CopilotEmptyState icon={BookOpen} title={copy.noHistory} />
      ) : (
        history.data.revisions.map((revision) => (
          <div className="space-y-2 rounded-md border border-border/70 p-3" key={revision.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs">v{revision.version} · {revision.action} · {revision.fileCount} {copy.files}</p>
              <Button
                size="sm"
                variant="outline"
                disabled={!skill.editable || revision.id === skill.revisionId}
                onClick={() => setPreview((current) => current === revision.id ? null : revision.id)}
              >
                {copy.rollback}
              </Button>
            </div>
            <p className="break-all text-xs text-muted-foreground">
              {revision.createdAt} · {revision.source.url ?? revision.source.label ?? revision.source.kind}
            </p>
            {preview === revision.id && <RevisionPreview skill={skill} revisionId={revision.id} />}
          </div>
        ))
      )}
    </div>
  );
}

function RevisionPreview({ skill, revisionId }: { skill: CopilotSkill; revisionId: string }) {
  const copy = useExtensionsCopy();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const revision = useQuery({
    queryKey: [...copilotSkillsKey, skill.id, "revisions", revisionId],
    queryFn: () => getSkillRevision(skill.id, revisionId),
    retry: false,
  });

  async function rollback() {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await rollbackCopilotSkill(skill.id, revisionId, skill.revisionId);
      await client.invalidateQueries({ queryKey: copilotSkillsKey });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-border/70 pt-2">
      {revision.isPending ? (
        <p>{copy.loading}</p>
      ) : revision.isError ? (
        <div role="alert" className="space-y-2 text-xs text-destructive">
          <p>{copy.loadError}</p>
          <Button size="sm" variant="outline" onClick={() => void revision.refetch()}>{copy.retry}</Button>
        </div>
      ) : (
        revision.data && (
          <>
            <p className="text-xs text-muted-foreground">{copy.rollbackHelp}</p>
            {revision.data.revision.files.map((file) => (
              <details key={file.path} className="text-xs">
                <summary className="break-all font-mono">{file.path}</summary>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/30 p-2">{file.content}</pre>
              </details>
            ))}
            <Button size="sm" disabled={busy} onClick={() => void rollback()}>{copy.rollbackConfirm}</Button>
          </>
        )
      )}
      {error && <p role="alert" className="text-sm text-destructive">{copy.error}</p>}
    </div>
  );
}
