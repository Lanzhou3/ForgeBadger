"use client";
import { Button } from "@/components/ui/button";
import type { ExtensionFile } from "@/lib/copilot-extensions-api";
import { useExtensionsCopy } from "./extensions-copy";

interface Props {
  currentFiles: ExtensionFile[];
  bundled: { version: string; files: ExtensionFile[] };
  busy: boolean;
  editable: boolean;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
  onAdopt: () => void;
  onKeep: () => void;
}
export function SkillUpdateComparison({ currentFiles, bundled, busy, editable, acknowledged, onAcknowledge, onAdopt, onKeep }: Props) {
  const copy = useExtensionsCopy();
  return <section className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
    <p className="text-sm">{copy.updateHelp}</p>
    <div className="grid gap-3 md:grid-cols-2">
      <PackagePreview title={copy.currentPackage} files={currentFiles} />
      <PackagePreview title={`${copy.bundledPackage} v${bundled.version}`} files={bundled.files} />
    </div>
    {editable && <>
      <p className="text-xs text-muted-foreground">{copy.adoptHelp}</p>
      <Button size="sm" disabled={busy} onClick={onAdopt}>{copy.adoptBuiltin}</Button>
      <div className="space-y-2 border-t border-border/70 pt-3">
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={acknowledged} disabled={busy} onChange={event => onAcknowledge(event.target.checked)} />{copy.acknowledge}</label>
        <Button size="sm" variant="outline" className="h-auto whitespace-normal text-left" disabled={busy || !acknowledged} onClick={onKeep}>{copy.keepReviewed}</Button>
      </div>
    </>}
  </section>;
}
function PackagePreview({ title, files }: { title: string; files: ExtensionFile[] }) {
  return <div className="min-w-0 space-y-2"><h3 className="text-sm font-medium">{title}</h3>
    <div className="max-h-64 space-y-2 overflow-auto rounded-md border border-border/70 p-2">
      {files.map(file => <details key={file.path} open={file.path === "SKILL.md"}>
        <summary className="break-all font-mono text-xs">{file.path}</summary>
        <pre className="whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">{file.content}</pre>
      </details>)}
    </div>
  </div>;
}
