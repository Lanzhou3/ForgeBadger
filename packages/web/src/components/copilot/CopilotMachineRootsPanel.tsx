"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderSearch, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CopilotEmptyState } from "./copilot-empty-state";
import { useMachineRootsCopy } from "./machine-roots-copy";
import {
  copilotMachineRootsKey,
  deleteCopilotMachineRoot,
  listCopilotMachineRoots,
  registerCopilotMachineRoot,
  type MachineRoot,
} from "@/lib/copilot-machine-roots-api";

/** Owner-managed local search roots for the read-only machine_search / read_machine_file tools. */
export function CopilotMachineRootsPanel() {
  const copy = useMachineRootsCopy();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const roots = useQuery({ queryKey: copilotMachineRootsKey, queryFn: listCopilotMachineRoots, retry: false });
  const items = roots.data?.roots ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{copy.help}</p>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          {copy.addRoot}
        </Button>
      </div>
      {roots.isPending ? (
        <p>{copy.loading}</p>
      ) : roots.isError ? (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{copy.loadError}</p>
          <Button variant="outline" size="sm" onClick={() => void roots.refetch()}>{copy.retry}</Button>
        </div>
      ) : items.length === 0 ? (
        <CopilotEmptyState icon={FolderSearch} title={copy.empty} description={copy.help} />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <RootCard key={item.id} root={item} onChanged={() => void client.invalidateQueries({ queryKey: copilotMachineRootsKey })} />
          ))}
        </div>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{copy.addRoot}</DialogTitle>
            <DialogDescription>{copy.pathHint}</DialogDescription>
          </DialogHeader>
          {creating && <RootForm onDone={() => setCreating(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RootForm({ onDone }: { onDone: () => void }) {
  const copy = useMachineRootsCopy();
  const client = useQueryClient();
  const [label, setLabel] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await registerCopilotMachineRoot({ label: label.trim(), path: rootPath.trim() });
      await client.invalidateQueries({ queryKey: copilotMachineRootsKey });
      onDone();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label className="block space-y-1 text-sm">
        <span>{copy.rootLabel}</span>
        <Input required maxLength={200} value={label} onChange={(event) => setLabel(event.target.value)} disabled={busy} />
      </label>
      <label className="block space-y-1 text-sm">
        <span>{copy.rootPath}</span>
        <Input required maxLength={1024} value={rootPath} onChange={(event) => setRootPath(event.target.value)} disabled={busy} placeholder={copy.pathHint} />
      </label>
      {error && <p role="alert" className="text-sm text-destructive">{copy.error}</p>}
      <Button type="submit" disabled={busy}>{copy.create}</Button>
    </form>
  );
}

function RootCard({ root, onChanged }: { root: MachineRoot; onChanged: () => void }) {
  const copy = useMachineRootsCopy();
  const client = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await deleteCopilotMachineRoot(root.id);
      await client.invalidateQueries({ queryKey: copilotMachineRootsKey });
      setDeleteOpen(false);
      onChanged();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="forgebadger-animate-in space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <FolderSearch className="size-4 shrink-0 text-brand" />
            <h2 className="break-all font-medium">{root.label}</h2>
            <Badge variant="secondary">{copy.registered}</Badge>
          </div>
          <p className="break-all text-xs text-muted-foreground">{root.path}</p>
        </div>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDeleteOpen(true)}>
          <Trash2 className="size-4" />
          {copy.delete}
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{copy.error}</p>}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{copy.deleteConfirm}</DialogTitle>
            <DialogDescription>{root.label}</DialogDescription>
          </DialogHeader>
          <Button variant="destructive" disabled={busy} onClick={() => void remove()}>{copy.delete}</Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
