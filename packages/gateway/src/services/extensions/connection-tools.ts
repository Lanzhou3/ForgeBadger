import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CopilotConnectionRepository, type ConnectionTool } from '../../db/repositories/copilot-connection-repository.js';
import type { Database } from '../../db/types.js';
import { CopilotConversationLog } from '../agent/conversation-log.js';
import { redactAgentValue } from '../agent/redaction.js';
import { createAgentToolRegistry, type AgentTool, type AgentToolRegistry } from '../agent/tool-registry.js';
import { connectionCredential, connectionToolName } from './connections.js';
import { callMcpTool, type McpClientOptions } from './mcp-client.js';
import { remoteInputSchema } from './remote-schema.js';

export function createConnectionTools(db: Database, userId: string, masterKey: string, options: McpClientOptions = {}): AgentTool[] {
 const repo=new CopilotConnectionRepository(db,userId), result: AgentTool[]=[];
 for(const row of repo.list()) {
  if(!row.enabled) continue;
  const selected=new Set(JSON.parse(row.enabled_tools_json) as string[]);
  for(const [index,tool] of (JSON.parse(row.tools_json) as ConnectionTool[]).entries()) {
   if(!tool.compatible||!selected.has(tool.name)) continue;
   let schema:z.ZodType<unknown>; try { schema=remoteInputSchema(tool.inputSchema); } catch { continue; }
   const name=connectionToolName(row,index);
   result.push({name,description:`[${row.name}: ${tool.name}] ${tool.description} Requires exact owner approval.`,risk:'operate',requiresApproval:true,inputSchema:schema,modelInputSchema:tool.inputSchema,
    async execute(input,context) {
     const preflight=()=>{
      const current=repo.get(row.id);
      if(context.userId!==userId||context.source!=='user'||!context.conversationId) throw new Error('External tool authority rejected');
      if(!current?.enabled||current.revision!==row.revision||!(JSON.parse(current.enabled_tools_json) as string[]).includes(tool.name)) throw new Error('Connection changed or disabled; create a fresh request');
      if(typeof context.checkExecutionAuthority!=='function'||!context.checkExecutionAuthority()) throw new Error('Run no longer active');
      const action=typeof context.externalActionId==='string'?new CopilotConversationLog(db,userId).getPendingAction(context.externalActionId):undefined;
      const digest=createHash('sha256').update(JSON.stringify(input)).digest('hex');
      if(!action||action.status!=='approved'||action.tool!==name||action.inputDigest!==digest||action.runId!==context.runId||action.stepId!==context.stepId) throw new Error('Exact external tool approval required');
     };
     preflight();
     const bearerToken=connectionCredential(row,masterKey);
     try {
      const output=await callMcpTool({endpoint:row.endpoint,...(bearerToken?{bearerToken}:{})},tool.name,input as Record<string,unknown>,preflight,options);
      const json=JSON.stringify(output);
      const redacted=bearerToken?json.replaceAll(bearerToken,'[REDACTED]'):json;
      return redactAgentValue(JSON.parse(redacted));
     } catch { throw new Error('External tool did not return a confirmed success; its outcome may be unknown. Do not retry automatically.'); }
    }
   });
  }
 }
 return result;
}
/** Local and MCP tools share registry shape and orchestrator policy, not an HTTP loopback. */
export function createConnectionToolRegistry(local: AgentTool[], db: Database, userId: string, masterKey: string, options: McpClientOptions = {}): AgentToolRegistry {
 const repo=new CopilotConnectionRepository(db,userId);
 let fingerprint: string | undefined, cached: AgentToolRegistry;
 const current=()=>{
  const next=repo.signature();
  if(next!==fingerprint){cached=createAgentToolRegistry([...local,...createConnectionTools(db,userId,masterKey,options)]);fingerprint=next;}
  return cached;
 };
 return {get tools(){return current().tools;},toModelSchemas(){return current().toModelSchemas();}};
}
