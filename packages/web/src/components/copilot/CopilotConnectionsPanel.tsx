"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plug, Plus, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CapabilitiesSection } from "./copilot-runtime-panel";
import { useExtensionsCopy } from "./extensions-copy";
import { copilotConnectionsKey, copilotSkillsKey, createCopilotConnection, deleteCopilotConnection, discoverCopilotConnection, listCopilotConnections, updateCopilotConnection, type CopilotConnection } from "@/lib/copilot-extensions-api";

export function CopilotConnectionsPanel() {
  const copy = useExtensionsCopy();
  const [creating, setCreating] = useState(false);
  const [builtinOpen, setBuiltinOpen] = useState(false);
  const connections = useQuery({ queryKey: copilotConnectionsKey, queryFn: listCopilotConnections, retry: false });
  const external = connections.data?.connections.filter(item => item.kind === "mcp") ?? [];
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{copy.connectionsHelp}</p><Button size="sm" onClick={() => setCreating(true)}><Plus className="size-4" />{copy.addConnection}</Button></div>
    <section className="forgebadger-animate-in space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2"><Wrench className="size-4 text-brand" /><h2 className="font-medium">ForgeBadger</h2><Badge variant="secondary">{copy.builtin}</Badge></div>
      <p className="text-sm text-muted-foreground">{copy.builtinHelp}</p>
      <Button size="sm" variant="outline" onClick={() => setBuiltinOpen(true)}>{copy.manageTools}</Button>
    </section>
    {connections.isPending ? <p>{copy.loading}</p> : connections.isError ? <div role="alert" className="space-y-2 text-sm text-destructive"><p>{copy.loadError}</p><Button variant="outline" size="sm" onClick={() => void connections.refetch()}>{copy.retry}</Button></div> : external.length === 0 ? <p className="text-sm text-muted-foreground">{copy.emptyConnections}</p> : external.map(item => <ConnectionCard key={`${item.id}:${item.revision}`} connection={item} />)}
    <Dialog open={builtinOpen} onOpenChange={setBuiltinOpen}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>ForgeBadger · {copy.tools}</DialogTitle><DialogDescription>{copy.builtinHelp}</DialogDescription></DialogHeader><CapabilitiesSection active={builtinOpen} /></DialogContent></Dialog>
    <Dialog open={creating} onOpenChange={setCreating}><DialogContent><DialogHeader><DialogTitle>{copy.addConnection}</DialogTitle><DialogDescription>{copy.connectHelp}</DialogDescription></DialogHeader>{creating && <ConnectionForm onDone={() => setCreating(false)} />}</DialogContent></Dialog>
  </div>;
}
function useRefreshConnections() {
  const client = useQueryClient();
  return async () => { await Promise.all([client.invalidateQueries({ queryKey: copilotConnectionsKey }), client.invalidateQueries({ queryKey: copilotSkillsKey })]); };
}
function ConnectionForm({ connection, onDone }: { connection?: CopilotConnection; onDone: () => void }) {
  const copy = useExtensionsCopy();
  const refresh = useRefreshConnections();
  const [name, setName] = useState(connection?.name ?? "");
  const [endpoint, setEndpoint] = useState(connection?.endpoint ?? "");
  const [revision] = useState(connection?.revision);
  const [bearer, setBearer] = useState("");
  const [clearCredential, setClearCredential] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function submit() {
    if (busy) return;
    const bearerToken = bearer; setBearer(""); setBusy(true); setError(false);
    try {
      const input = { name: name.trim(), endpoint: endpoint.trim() };
      if (connection && revision !== undefined) await updateCopilotConnection(connection.id, { revision, ...input, ...(clearCredential ? { bearerToken: null } : bearerToken ? { bearerToken } : {}) });
      else await createCopilotConnection({ ...input, ...(bearerToken ? { bearerToken } : {}) });
      await refresh(); onDone();
    } catch { setError(true); } finally { setBusy(false); }
  }
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <label className="block space-y-1 text-sm"><span>{copy.name}</span><Input required maxLength={80} value={name} onChange={event => setName(event.target.value)} disabled={busy} /></label>
    <label className="block space-y-1 text-sm"><span>{copy.endpoint}</span><Input required type="url" maxLength={2048} pattern="https://.*" value={endpoint} onChange={event => setEndpoint(event.target.value)} disabled={busy} placeholder="https://mcp.example.com/mcp" /></label>
    <label className="block space-y-1 text-sm"><span>{copy.bearer}</span><Input type="password" maxLength={4096} autoComplete="new-password" value={bearer} onChange={event => setBearer(event.target.value)} disabled={busy || clearCredential} placeholder={connection?.hasCredential ? copy.credentialKeep : ""} /></label>
    {connection?.hasCredential && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={clearCredential} disabled={busy} onChange={event => { setClearCredential(event.target.checked); setBearer(""); }} />{copy.clearCredential}</label>}
    {connection && <p className="text-xs text-muted-foreground">{copy.configurationHelp}</p>}
    <p className="text-xs text-muted-foreground">{copy.remoteApproval}</p>
    {error && <p role="alert" className="text-sm text-destructive">{copy.error}</p>}
    <Button type="submit" disabled={busy}>{busy ? copy.refreshing : connection ? copy.save : copy.create}</Button>
  </form>;
}
function ConnectionCard({ connection }: { connection: CopilotConnection }) {
  const copy = useExtensionsCopy(); const refresh = useRefreshConnections();
  const [editing, setEditing] = useState(false); const [toolsOpen, setToolsOpen] = useState(false); const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState(connection.tools.filter(tool => tool.enabled).map(tool => tool.name));
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  async function perform(action: () => Promise<unknown>) {
    if (busy) return; setBusy(true); setError(false);
    try { await action(); await refresh(); } catch { setError(true); } finally { setBusy(false); }
  }
  return <section className="forgebadger-animate-in space-y-3 rounded-lg border border-border bg-card p-4 transition-colors">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0 space-y-1"><div className="flex flex-wrap items-center gap-2"><Plug className="size-4 shrink-0 text-brand" /><h2 className="break-all font-medium">{connection.name}</h2><Badge variant="outline">MCP</Badge><Badge variant="secondary">{connection.enabled ? copy.enabled : copy.disabled}</Badge></div><p className="break-all text-xs text-muted-foreground">{connection.endpoint}</p></div><Switch aria-label={connection.name} disabled={busy} checked={connection.enabled} onCheckedChange={enabled => void perform(() => updateCopilotConnection(connection.id, { revision: connection.revision, enabled }))} /></div>
    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><span>{connection.status === "not_discovered" ? copy.notDiscovered : `${connection.tools.filter(tool => tool.enabled && tool.compatible).length}/${connection.tools.length} ${copy.tools}`}</span>{connection.hasCredential && <span>· {copy.credentialSet}</span>}</div>
    <p className="text-xs text-muted-foreground">{copy.remoteApproval}</p>
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void perform(() => discoverCopilotConnection(connection.id, connection.revision))}>{busy ? copy.refreshing : copy.discover}</Button><Button size="sm" variant="outline" disabled={busy || connection.status !== "ready"} onClick={() => setToolsOpen(value => !value)}>{copy.selectTools}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(true)}>{copy.edit}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setDeleteOpen(true)}>{copy.delete}</Button></div>
    {toolsOpen && <div className="space-y-3 border-t border-border/70 pt-3">
      {connection.tools.length === 0 && <p className="text-sm text-muted-foreground">{copy.noTools}</p>}
      {connection.tools.map(tool => <div key={tool.name} className="space-y-1 rounded-md border border-border/70 p-3"><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={selected.includes(tool.name)} disabled={busy || !tool.compatible} onChange={event => setSelected(current => event.target.checked ? [...current, tool.name] : current.filter(name => name !== tool.name))} /><span className="min-w-0"><span className="break-all font-mono">{tool.name}</span><span className="mt-1 block text-xs text-muted-foreground">{tool.description}</span></span></label><p className="break-all text-xs text-muted-foreground">{tool.modelName}</p>{!tool.compatible && <p className="text-xs text-amber-500">{copy.incompatible}: {tool.unavailableReason}</p>}<details className="text-xs text-muted-foreground"><summary>{copy.schema}</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(tool.inputSchema, null, 2)}</pre></details></div>)}
      <Button size="sm" disabled={busy} onClick={() => void perform(() => updateCopilotConnection(connection.id, { revision: connection.revision, enabledTools: selected }))}>{copy.saveTools}</Button>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{copy.error}</p>}
    <Dialog open={editing} onOpenChange={setEditing}><DialogContent><DialogHeader><DialogTitle>{copy.editConnection}</DialogTitle><DialogDescription>{copy.configurationHelp}</DialogDescription></DialogHeader>{editing && <ConnectionForm connection={connection} onDone={() => setEditing(false)} />}</DialogContent></Dialog>
    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}><DialogContent><DialogHeader><DialogTitle>{copy.deleteConfirm}</DialogTitle><DialogDescription>{connection.name}</DialogDescription></DialogHeader><Button variant="destructive" disabled={busy} onClick={() => void perform(() => deleteCopilotConnection(connection.id, connection.revision))}>{copy.delete}</Button>{error && <p role="alert" className="text-sm text-destructive">{copy.error}</p>}</DialogContent></Dialog>
  </section>;
}
