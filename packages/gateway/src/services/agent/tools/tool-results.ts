import { CopilotToolArtifactRepository } from '../../../db/repositories/copilot-tool-artifact-repository.js';
import { assertRestrictedTool } from '../restricted-runs.js';
import { z } from 'zod';
import { CopilotToolResultRepository, type ToolResultSource } from '../../../db/repositories/copilot-tool-result-repository.js';
import { ProjectRepository } from '../../../db/repositories/project-repository.js';
import { SessionRepository } from '../../../db/repositories/session-repository.js';
import { CopilotRunLedger, type TurnInput } from '../run-ledger.js';
import { checkAgentScope } from '../../platform-commands/agent-scope.js';
import type { AgentTool, AgentToolContext } from '../tool-registry.js';
const inputSchema=z.object({messageId:z.string().uuid(),projectId:z.string().min(1).max(128).optional(),offset:z.number().int().min(0).max(2_097_152).default(0),length:z.number().int().min(1).max(6000).default(4000)}).strict();
const denied=()=>new Error('COPILOT_TOOL_RESULT_UNAVAILABLE');
export function createToolResultTools(): AgentTool[] {
  return [{name:'read_tool_result',description:'Read a paginated persisted tool receipt referenced by context messageId in this conversation. Access and source tool visibility are rechecked. Full redacted snapshots are available for eligible built-in reads for 7 days within quotas. Legacy/disallowed/expired results retain only previews. Restricted research must provide its projectId. Offsets count UTF-16 characters.',
    risk:'read',requiresApproval:false,inputSchema,
    async execute(input,context) {
      const args=inputSchema.parse(input);
      const source=authorizeSource(context,args.messageId);
      const manifest = artifactManifest(source.content);
      const artifact = manifest?.status === 'available'
        ? new CopilotToolArtifactRepository(context.db, context.userId, context.masterKey).read(context.conversationId!, source)
        : { status: manifest?.status ?? 'legacy' };
      const content = artifact.content ?? source.content;
      return {messageId:args.messageId,runId:source.runId,stepId:source.stepId,toolName:source.toolName,
        content:content.slice(args.offset,args.offset+args.length),offset:args.offset,
        nextOffset:args.offset+args.length<content.length?args.offset+args.length:null,
        totalChars:content.length,originalOutputTruncated:originalTruncated(content),
        artifactStatus:artifact.status, evidence:artifact.status === 'available'
          ? 'Complete redacted tool snapshot at execution time; not current filesystem state.'
          : 'Persisted redacted receipt preview only; full output unavailable.'};
    }}];
}
function authorizeSource(context: AgentToolContext,messageId:string): ToolResultSource {
  const {conversationId,runId,availableToolNames,checkExecutionAuthority}=context;
  if (!conversationId || typeof runId!=='string' || typeof checkExecutionAuthority!=='function' || !checkExecutionAuthority()) throw denied();
  const source=new CopilotToolResultRepository(context.db,context.userId).get(conversationId,messageId);
  if (!source || !Array.isArray(availableToolNames) || !availableToolNames.includes(source.toolName)) throw denied();
  // External MCP receipts can contain resources whose current permissions cannot
  // be revalidated without an external call. Do not bypass that approval boundary.
  if (source.toolName.startsWith('mcp_') || ['read_tool_result','load_playbook','read_skill_resource','list_playbooks'].includes(source.toolName)) throw denied();
  const ledger=new CopilotRunLedger(context.db,context.userId);
  const current=ledger.get(runId);
  if (!current || current.conversation_id!==conversationId) throw denied();
  const originalInput=parseRun(source.runInputJson,context);
  const currentInput=parseRun(current.input_json,context);
  ledger.validateScope(originalInput);
  ledger.validateScope(currentInput);
  const raw:unknown=JSON.parse(source.inputJson);
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) throw denied();
  assertRestrictedTool(context,source.toolName,raw);
  checkAgentScope(context,source.toolName,raw);
  validateResources(context,raw as Record<string,unknown>);
  if (!checkExecutionAuthority()) throw denied();
  return source;
}
function parseRun(json:string,context:AgentToolContext):TurnInput {
  const input=JSON.parse(json) as TurnInput;
  if (input.userId!==context.userId || input.conversationId!==context.conversationId) throw denied();
  return input;
}
function validateResources(context:AgentToolContext,input:Record<string,unknown>):void {
  if (typeof input.projectId==='string' && !new ProjectRepository(context.db,context.userId).getById(input.projectId)) throw denied();
  if (typeof input.sessionId==='string' && !new SessionRepository(context.db,context.userId).getById(input.sessionId)) throw denied();
  if (typeof input.conversationId==='string' && input.conversationId!==context.conversationId) throw denied();
}
function originalTruncated(content:string):boolean {
  try {
    const receipt=JSON.parse(content) as {truncated?:boolean;output?:{truncated?:boolean}};
    return receipt.truncated===true || receipt.output?.truncated===true;
  } catch {return false;}
}

function artifactManifest(content:string): {status:string}|undefined {
  try { return z.object({artifact:z.object({status:z.string()}).optional()}).parse(JSON.parse(content)).artifact; }
  catch { return undefined; }
}
