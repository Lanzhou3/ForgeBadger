"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plug, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useLanguage } from "@/hooks/use-language";
import {
  createMcpToken,
  getMcpStatus,
  listMcpTokens,
  mcpStatusKey,
  mcpTokensKey,
  revokeMcpToken,
  type McpToken,
  type McpTokenScope,
} from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * MCP integration card: external agents (Claude Code, MCP Inspector, ...)
 * connect to the Gateway's /mcp endpoint with a long-lived access token.
 * The plaintext token is returned exactly once by the API, so it is shown
 * in a one-time dialog right after creation.
 */
export function McpIntegrationSettings() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<McpTokenScope[]>(["read"]);
  const [plaintextToken, setPlaintextToken] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<McpToken | null>(null);

  const status = useQuery({ queryKey: mcpStatusKey, queryFn: getMcpStatus, retry: false });
  const enabled = status.data?.enabled === true;
  const tokens = useQuery({
    queryKey: mcpTokensKey,
    queryFn: listMcpTokens,
    retry: false,
    enabled,
    // lastUsedAt updates as clients use a token; poll so the list self-heals
    // without waiting for a create/revoke to invalidate it.
    refetchInterval: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: createMcpToken,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: mcpTokensKey });
      setPlaintextToken(result.plaintext);
      setName("");
    },
    onError: () => toast.error(t("settings.mcpCreateFailed")),
  });

  const revokeMutation = useMutation({
    mutationFn: revokeMcpToken,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mcpTokensKey });
      setRevoking(null);
    },
    onError: () => toast.error(t("settings.mcpRevokeFailed")),
  });

  const endpoint = status.data?.endpoint ?? "";

  async function copyText(text: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("settings.mcpCopied"));
    } catch {
      toast.error(t("settings.mcpCopyFailed"));
    }
  }

  function toggleScope(scope: McpTokenScope) {
    const active = scopes.includes(scope);
    // Keep at least one scope selected.
    if (active && scopes.length === 1) return;
    setScopes(active ? scopes.filter((item) => item !== scope) : [...scopes, scope]);
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || scopes.length === 0) return;
    createMutation.mutate({ name: name.trim(), scopes });
  }

  return (
    <Card className="forgebadger-animate-in">
      <CardHeader className="flex flex-row items-center gap-3 space-y-0">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
          <Plug className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <CardTitle className="text-sm font-semibold">{t("settings.mcp")}</CardTitle>
          <CardDescription className="mt-1 text-xs">
            {t("settings.mcpDescription")}
          </CardDescription>
        </div>
        {status.data && (
          <Badge variant={enabled ? "secondary" : "outline"}>
            {enabled ? t("settings.mcpStateEnabled") : t("settings.mcpStateDisabled")}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {status.isError ? (
          <p className="text-xs text-destructive">{t("settings.mcpLoadFailed")}</p>
        ) : status.isLoading ? (
          <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <>
            {enabled ? (
              <div className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/20 px-3 py-2">
                <span className="text-xs text-muted-foreground">{t("settings.mcpEndpoint")}</span>
                <span className="min-w-0 flex-1 break-all font-mono text-xs">{endpoint}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0"
                  aria-label={t("settings.mcpEndpoint")}
                  onClick={() => void copyText(endpoint)}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
            ) : (
              <div className="rounded-md border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
                {t("settings.mcpDisabledHint")}
                <span className="mt-1 block font-mono">FORGEBADGER_MCP_ENABLED=true</span>
              </div>
            )}
            {enabled && <McpTokensSection endpoint={endpoint} scopes={scopes} onToggleScope={toggleScope} onCreate={handleCreate} creating={createMutation.isPending} name={name} onNameChange={setName} tokens={tokens.data?.tokens ?? undefined} loading={tokens.isLoading} error={tokens.isError} onRevoke={setRevoking} />}
          </>
        )}
      </CardContent>

      <McpPlaintextDialog plaintext={plaintextToken} onClose={() => setPlaintextToken(null)} onCopy={copyText} />
      <Dialog open={revoking !== null} onOpenChange={(open) => !open && setRevoking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.mcpRevokeConfirm")}</DialogTitle>
            <DialogDescription>{revoking?.name}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoking(null)}>
              {t("settings.mcpClose")}
            </Button>
            <Button
              variant="destructive"
              disabled={revokeMutation.isPending}
              onClick={() => revoking && revokeMutation.mutate(revoking.id)}
            >
              {t("settings.mcpRevoke")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function McpTokensSection({
  endpoint,
  scopes,
  onToggleScope,
  onCreate,
  creating,
  name,
  onNameChange,
  tokens,
  loading,
  error,
  onRevoke,
}: {
  endpoint: string;
  scopes: McpTokenScope[];
  onToggleScope: (scope: McpTokenScope) => void;
  onCreate: (event: FormEvent) => void;
  creating: boolean;
  name: string;
  onNameChange: (value: string) => void;
  tokens?: McpToken[];
  loading: boolean;
  error: boolean;
  onRevoke: (token: McpToken) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="space-y-3">
      <form onSubmit={onCreate} className="space-y-2.5">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <Label className="text-xs" htmlFor="mcp-token-name">
              {t("settings.mcpName")}
            </Label>
            <Input
              id="mcp-token-name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              maxLength={64}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex items-center gap-3 pb-1.5">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <Checkbox
                checked={scopes.includes("read")}
                onCheckedChange={() => onToggleScope("read")}
                aria-label={t("settings.mcpScopeRead")}
              />
              {t("settings.mcpScopeRead")}
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <Checkbox
                checked={scopes.includes("operate")}
                onCheckedChange={() => onToggleScope("operate")}
                aria-label={t("settings.mcpScopeOperate")}
              />
              {t("settings.mcpScopeOperate")}
            </label>
            <Button
              type="submit"
              size="sm"
              className="h-8"
              disabled={creating || !name.trim()}
            >
              {creating ? t("common.loading") : t("settings.mcpCreate")}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("settings.mcpScopeOperateHelp")}</p>
      </form>

      <div className="rounded-md border border-border/70">
        {error ? (
          <p className="p-3 text-xs text-destructive">{t("settings.mcpLoadFailed")}</p>
        ) : loading ? (
          <p className="p-3 text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : tokens && tokens.length > 0 ? (
          <div className="divide-y divide-border/70">
            {tokens.map((token) => (
              <div
                key={token.id}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 ${
                  token.revoked ? "opacity-60" : ""
                }`}
              >
                <span className="min-w-0 truncate text-sm font-medium">{token.name}</span>
                {token.scopes.map((scope) => (
                  <Badge key={scope} variant={scope === "operate" ? "secondary" : "outline"}>
                    {scope === "operate"
                      ? t("settings.mcpScopeOperate")
                      : t("settings.mcpScopeRead")}
                  </Badge>
                ))}
                {token.revoked && (
                  <Badge variant="destructive">{t("settings.mcpRevoked")}</Badge>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {token.lastUsedAt
                    ? `${t("settings.mcpLastUsed")}: ${new Date(token.lastUsedAt).toLocaleString()}`
                    : t("settings.mcpNeverUsed")}
                </span>
                {!token.revoked && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-destructive hover:text-destructive"
                    aria-label={`${t("settings.mcpRevoke")} ${token.name}`}
                    onClick={() => onRevoke(token)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="p-3 text-xs text-muted-foreground">{t("settings.mcpEmpty")}</p>
        )}
      </div>

      <McpConnectExamples endpoint={endpoint} />
    </div>
  );
}

function McpConnectExamples({ endpoint }: { endpoint: string }) {
  const { t } = useLanguage();
  const tokenPlaceholder = t("settings.mcpTokenPlaceholder");
  const cliCommand = `claude mcp add --transport http forgebadger ${endpoint} --header "Authorization: Bearer ${tokenPlaceholder}"`;
  const clientConfig = JSON.stringify(
    {
      mcpServers: {
        forgebadger: {
          type: "http",
          url: endpoint,
          headers: { Authorization: `Bearer ${tokenPlaceholder}` },
        },
      },
    },
    null,
    2
  );
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t("settings.mcpConnectHelp")}</p>
      <SnippetBlock label={t("settings.mcpConnectCli")} content={cliCommand} />
      <SnippetBlock label={t("settings.mcpConnectJson")} content={clientConfig} />
    </div>
  );
}

function SnippetBlock({ label, content }: { label: string; content: string }) {
  const { t } = useLanguage();
  async function copy() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(content);
      toast.success(t("settings.mcpCopied"));
    } catch {
      toast.error(t("settings.mcpCopyFailed"));
    }
  }
  return (
    <div className="rounded-md border border-border/70 bg-muted/20">
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-1.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Button type="button" variant="ghost" size="icon" className="size-6" aria-label={label} onClick={() => void copy()}>
          <Copy className="size-3.5" />
        </Button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">{content}</pre>
    </div>
  );
}

function McpPlaintextDialog({
  plaintext,
  onClose,
  onCopy,
}: {
  plaintext: string | null;
  onClose: () => void;
  onCopy: (text: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <Dialog open={plaintext !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settings.mcpPlaintextTitle")}</DialogTitle>
          <DialogDescription>{t("settings.mcpPlaintextWarning")}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/20 px-3 py-2">
          <span className="min-w-0 flex-1 break-all font-mono text-xs">{plaintext}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => plaintext && onCopy(plaintext)}
          >
            <Copy className="size-3.5" />
            {t("settings.mcpCopy")}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t("settings.mcpClose")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
