"use client";
import { useState, type InputHTMLAttributes } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { copilotSkillsKey, importCopilotSkill, type ExtensionFile } from "@/lib/copilot-extensions-api";
import { readSkillFiles, validateSkillFiles } from "@/lib/copilot-skill-files";
import { useExtensionsCopy } from "./extensions-copy";
export function SkillFilePicker({ disabled, onFiles }: { disabled?: boolean; onFiles: (files: ExtensionFile[]) => void }) {
  const copy = useExtensionsCopy(); const [error, setError] = useState(false); const [busy, setBusy] = useState(false);
  async function read(input: HTMLInputElement) {
    if (!input.files) return; setBusy(true); setError(false);
    try { onFiles(await readSkillFiles(input.files)); } catch { setError(true); } finally { setBusy(false); input.value = ""; }
  }
  const folderAttributes = { webkitdirectory: "" } as InputHTMLAttributes<HTMLInputElement>;
  return <div className="space-y-2"><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-xs"><span>{copy.chooseFiles}</span><Input type="file" multiple disabled={disabled || busy} onChange={event => void read(event.currentTarget)} /></label><label className="space-y-1 text-xs"><span>{copy.chooseFolder}</span><Input type="file" multiple {...folderAttributes} disabled={disabled || busy} onChange={event => void read(event.currentTarget)} /></label></div>{busy && <p className="text-xs">{copy.loading}</p>}{error && <p role="alert" className="text-xs text-destructive">{copy.fileError}</p>}</div>;
}
export function CopilotSkillImport({ onDone }: { onDone: () => void }) {
  const copy = useExtensionsCopy(); const client = useQueryClient();
  const [method, setMethod] = useState("paste"); const [content, setContent] = useState(""); const [url, setUrl] = useState("");
  const [files, setFiles] = useState<ExtensionFile[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (busy) return; setError(null);
    const bundle = method === "paste" ? [{ path: "SKILL.md", content }] : files;
    if (method !== "url") { try { validateSkillFiles(bundle); } catch { setError(copy.fileError); return; } }
    setBusy(true);
    try {
      await importCopilotSkill(method === "url" ? { source: { kind: "url", url: url.trim() } } : { source: { kind: method === "paste" ? "paste" : "upload" }, files: bundle });
      await client.invalidateQueries({ queryKey: copilotSkillsKey }); onDone();
    } catch { setError(copy.error); } finally { setBusy(false); }
  }
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <label className="block space-y-1 text-sm"><span>{copy.importMethod}</span><select aria-label={copy.importMethod} className="h-9 w-full rounded-md border border-input bg-background px-2" value={method} disabled={busy} onChange={event => { setMethod(event.target.value); setError(null); }}><option value="paste">{copy.paste}</option><option value="upload">{copy.upload}</option><option value="url">{copy.url}</option></select></label>
    {method === "paste" ? <label className="block space-y-1 text-sm"><span>{copy.importContent}</span><Textarea required className="min-h-64 font-mono text-xs" value={content} disabled={busy} onChange={event => setContent(event.target.value)} placeholder={'---\nname: project-review\ndescription: Review project status\n---\n# Project review\n'} /></label> : method === "url" ? <div className="space-y-2"><label className="block space-y-1 text-sm"><span>{copy.url}</span><Input required type="url" pattern="https://.*" value={url} disabled={busy} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/SKILL.md" /></label><p className="text-xs text-muted-foreground">{copy.urlHelp}</p></div> : <div className="space-y-2"><SkillFilePicker disabled={busy} onFiles={setFiles} /><p className="text-xs text-muted-foreground">{copy.selectedFiles}: {files.length}</p><ul className="max-h-32 overflow-auto text-xs">{files.map(file => <li key={file.path} className="break-all font-mono">{file.path}</li>)}</ul></div>}
    <p className="text-xs text-muted-foreground">{copy.importHelp}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={busy || (method === "upload" && !files.length)}>{busy ? copy.refreshing : copy.install}</Button>
  </form>;
}
