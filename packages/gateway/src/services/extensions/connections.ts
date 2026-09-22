import { UserRepository } from '../../db/repositories/user-repository.js';
import { decryptSecret, encryptSecret, type EncryptedSecret } from '../../crypto/secret-box.js';
import { CopilotConnectionRepository, type ConnectionRecord, type ConnectionTool } from '../../db/repositories/copilot-connection-repository.js';
import type { Database } from '../../db/types.js';
import { assertPublicHttpsEndpoint } from '../network-policy.js';
import { discoverMcpTools, type McpClientOptions } from './mcp-client.js';
import { redactAgentText } from '../agent/redaction.js';
export const connectionToolName = (row: ConnectionRecord, index: number) => `mcp_${row.id.replaceAll('-', '')}_${row.revision}_${index}`;
export function connectionCredential(row: ConnectionRecord, masterKey: string): string | undefined {
 return row.credential_encrypted ? decryptSecret(JSON.parse(row.credential_encrypted) as EncryptedSecret, { key: masterKey }) : undefined;
}
export function presentConnection(row: ConnectionRecord) {
 const enabled = new Set(JSON.parse(row.enabled_tools_json) as string[]);
 return { id: row.id, kind: 'mcp' as const, name: row.name, endpoint: row.endpoint, enabled: !!row.enabled, revision: row.revision,
  hasCredential: !!row.credential_encrypted, status: row.last_discovered_at === null ? 'not_discovered' : 'ready', lastDiscoveredAt: row.last_discovered_at,
  tools: (JSON.parse(row.tools_json) as ConnectionTool[]).map((tool,index) => ({ ...tool, modelName: connectionToolName(row,index), enabled: enabled.has(tool.name) })) };
}
export function validateConnectionEndpoint(endpoint: string): string {
 assertPublicHttpsEndpoint(endpoint);
 const url = new URL(endpoint);
 if (url.search || url.hash) throw new Error('Endpoint must not contain credentials, query or fragment');
 return url.href;
}
export class CopilotConnections {
 readonly repo: CopilotConnectionRepository;
 constructor(private db: Database, private userId: string, private masterKey: string, private clientOptions: McpClientOptions = {}) { this.repo = new CopilotConnectionRepository(db,userId); }
 create(input: { name: string; endpoint: string; bearerToken?: string | undefined }) {
  const endpoint = validateConnectionEndpoint(input.endpoint);
  return presentConnection(this.repo.create(input.name,endpoint,this.encrypt(input.bearerToken)));
 }
 update(id: string, input: { revision: number; name?: string | undefined; endpoint?: string | undefined; bearerToken?: string | null | undefined; enabled?: boolean | undefined; enabledTools?: string[] | undefined }) {
  const row=this.require(id); const endpoint=input.endpoint === undefined ? row.endpoint : validateConnectionEndpoint(input.endpoint);
  const reset=endpoint!==row.endpoint || input.bearerToken!==undefined;
  const tools=reset ? [] : JSON.parse(row.tools_json) as ConnectionTool[];
  const selected=input.enabledTools ?? (reset ? [] : JSON.parse(row.enabled_tools_json) as string[]);
  if (selected.some(name=>!tools.some(tool=>tool.name===name && tool.compatible))) throw new Error('Select only compatible discovered tools');
  return presentConnection(this.repo.save(id,input.revision,{...row,name:input.name??row.name,endpoint,
   credential_encrypted:input.bearerToken===undefined?row.credential_encrypted:this.encrypt(input.bearerToken??undefined),enabled:input.enabled===undefined?row.enabled:Number(input.enabled),
   tools_json:JSON.stringify(tools),enabled_tools_json:JSON.stringify([...new Set(selected)]),last_discovered_at:reset?null:row.last_discovered_at}));
 }
 async discover(id: string, revision: number) {
  const row=this.require(id);
  if(row.revision!==revision) throw new Error('Connection changed; reload before discovery');
  const bearerToken=connectionCredential(row,this.masterKey);
  const preflight = () => {
   if (this.repo.get(id)?.revision !== revision || new UserRepository(this.db).findById(this.userId)?.status !== 'active') throw new Error('Discovery authority changed');
  };
  preflight();
  const tools=await discoverMcpTools({endpoint:row.endpoint,...(bearerToken?{bearerToken}:{})},this.clientOptions,preflight);
  preflight();
  // Credential echo is never persisted in remote metadata.
  const safe=JSON.stringify(tools); const cleaned=bearerToken?safe.replaceAll(bearerToken,'[REDACTED]'):safe;
  const next=JSON.parse(redactAgentText(cleaned)) as ConnectionTool[];
  const old=JSON.parse(row.tools_json) as ConnectionTool[];
  const selected=(JSON.parse(row.enabled_tools_json) as string[]).filter(name=>next.some(t=>t.name===name&&t.compatible&&JSON.stringify(t)===JSON.stringify(old.find(o=>o.name===name))));
  return presentConnection(this.repo.save(id,revision,{...row,tools_json:JSON.stringify(next),enabled_tools_json:JSON.stringify(selected),last_discovered_at:Date.now()}));
 }
 require(id: string) { const row=this.repo.get(id); if(!row) throw new Error('Connection not found'); return row; }
 private encrypt(value?: string) { return value ? JSON.stringify(encryptSecret(value,{key:this.masterKey})) : null; }
}
