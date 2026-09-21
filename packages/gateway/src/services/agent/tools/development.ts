import { z } from 'zod';
import type { AgentTool } from '../tool-registry.js';
import { redactAgentValue } from '../redaction.js';
import { executeAgentAction } from '../../platform-commands/agent-actions.js';
import { DevelopmentTaskRepository } from '../../../db/repositories/development-task-repository.js';
import { developmentPlanSchema,developmentId,sourcePathSchema,taskSummary } from '../../development/contracts.js';
import { developmentTaskInput,developmentAcceptInput,ownedProject } from '../../development/commands.js';
import { readSource,listSourceFiles } from '../../development/workspace.js';

export function createDevelopmentTools():AgentTool[] {
 const read=(name:string,description:string,inputSchema:AgentTool['inputSchema'],execute:AgentTool['execute']):AgentTool=>({name,description,inputSchema,execute,risk:'read',requiresApproval:false});
 return [
  read('list_project_files','List bounded, non-hidden source paths for planning a controlled development task. Skips dependencies and secrets.',z.object({projectId:developmentId,path:sourcePathSchema.optional(),limit:z.number().int().min(1).max(200).optional()}).strict(),async(raw,ctx)=>{const v=raw as {projectId:string;path?:string;limit?:number};return listSourceFiles(ownedProject(ctx,v.projectId).path,v.path,v.limit);}),
  read('read_project_file','Read source text and SHA256 for an exact proposed edit or test. No symlinks, hidden or credential files.',z.object({projectId:developmentId,path:sourcePathSchema,offset:z.number().int().min(0).max(65536).optional(),length:z.number().int().min(1).max(16000).optional()}).strict(),async(raw,ctx)=>{const v=raw as {projectId:string;path:string;offset?:number;length?:number};const source=readSource(ownedProject(ctx,v.projectId).path,v.path);const view=redactAgentValue(source.content) as string;const offset=v.offset??0,end=Math.min(view.length,offset+(v.length??12000));return {path:source.path,sha256:source.sha256,sha256Of:'original_file',content:view.slice(offset,end),redacted:view!==source.content,offsetSpace:'redacted_text',offset,nextOffset:end<view.length?end:null,totalChars:view.length};}),
  read('list_development_tasks','List controlled development task states for a project.',z.object({projectId:developmentId}).strict(),async(raw,ctx)=>{const v=raw as {projectId:string};ownedProject(ctx,v.projectId);return {tasks:new DevelopmentTaskRepository(ctx.db,ctx.userId).list(v.projectId).map(taskSummary)};}),
  read('get_development_task','Read finite test receipts and diff evidence. checks_passed is not owner acceptance or a merged change.',developmentTaskInput.extend({offset:z.number().int().min(0).max(2000000).optional(),length:z.number().int().min(1).max(6000).optional()}),async(raw,ctx)=>{const v=raw as {projectId:string;taskId:string;offset?:number;length?:number};ownedProject(ctx,v.projectId);const row=new DevelopmentTaskRepository(ctx.db,ctx.userId).get(v.taskId,v.projectId);if(!row)throw new Error('DEVELOPMENT_TASK_NOT_FOUND');const evidence=row.evidence_json??'',offset=v.offset??0,end=Math.min(evidence.length,offset+(v.length??6000));return {task:taskSummary(row),evidence:evidence.slice(offset,end),nextOffset:end<evidence.length?end:null,totalChars:evidence.length};}),
  ...[
   {name:'submit_development_task',description:'Queue an immutable patch recipe in an isolated, credential-free macOS Node test sandbox after exact owner approval. Include source files, expected original hashes, edited contents and required test hashes. Never writes the original project; no CLI dispatch.',schema:developmentPlanSchema},
   {name:'cancel_development_task',description:'Request cancellation of a queued or running controlled development task.',schema:developmentTaskInput},
   {name:'accept_development_task',description:'Owner acceptance of a checks-passed, unchanged artifact digest. Does not merge or write to the source project.',schema:developmentAcceptInput}
  ].map(v=>({name:v.name,description:v.description,inputSchema:v.schema,risk:'operate' as const,requiresApproval:true,execute:(raw:unknown,ctx:Parameters<typeof executeAgentAction>[2])=>executeAgentAction(v.name,raw,ctx)}))
 ];
}
