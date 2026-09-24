import { z } from 'zod';
import { CopilotToolResultRepository, type ToolResultSource } from '../../../db/repositories/copilot-tool-result-repository.js';
import { ProjectRepository } from '../../../db/repositories/project-repository.js';
import { SessionRepository } from '../../../db/repositories/session-repository.js';
import { CopilotRunLedger, type TurnInput } from '../run-ledger.js';
import { checkAgentScope } from '../../platform-commands/agent-scope.js';
import type { AgentTool, AgentToolContext } from '../tool-registry.js';
const inputSchema=z.object({messageId:z.string().uuid(),offset:z.number().int().min(0).max(1_000_000).default(0),length:z.number().int().min(1).max(6000).default(4000)}).strict();
const denied=()=>new Error('COPILOT_TOOL_RESULT_UNAVAILABLE');
export function createToolResultTools(): AgentTool[] {
  return [{name:'read_tool_result',description:'Read a paginated persisted tool receipt referenced by context messageId in this conversation. Access and source tool visibility are rechecked. Original output may already be truncated; this does not recover discarded raw output. Offsets count UTF-16 characters.',
    risk:'read',requiresApproval:false,inputSchema,
    async execute(input,context) {
      const args=inputSchema.parse(input);
      const source=authorizeSource(context,args.messageId);
      return {messageId:args.messageId,runId:source.runId,stepId:source.stepId,toolName:source.toolName,
        content:source.content.slice(args.offset,args.offset+args.length),offset:args.offset,
        nextOffset:args.offset+args.length<source.content.length?args.offset+args.length:null,
        totalChars:source.content.length,originalOutputTruncated:originalTruncated(source.content),
        evidence:'Persisted redacted receipt only; discarded original output cannot be recovered.'};
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
