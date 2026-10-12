import type { ForgeBadgerEventBus } from '../event-bus.js';
import { randomUUID } from 'node:crypto';
import type { Database } from '../../db/types.js';
import { DevelopmentTaskRepository } from '../../db/repositories/development-task-repository.js';
import { CopilotRunLedger, type TurnInput } from './run-ledger.js';
import { repairJob, validateRepairJob, type RepairJob } from '../development/repair-scope.js';
import { redactAgentText } from './redaction.js';

export interface RepairOrigin { rootTaskId:string; failedTaskId:string; attempt:number; evidenceDigest:string }
export function repairIdentity(userId:string,input:TurnInput):RepairJob {
  const value=input.repairOrigin;
  if(!value||!input.parentRunId)throw new Error('COPILOT_REPAIR_ORIGIN_MISSING');
  return {id:'admission',user_id:userId,root_task_id:value.rootTaskId,failed_task_id:value.failedTaskId,
    origin_run_id:input.parentRunId,child_run_id:'admission',attempt:value.attempt,evidence_digest:value.evidenceDigest,
    submission_step_id:null,submitted_task_id:null,report_message_id:null};
}

/** Failure notification and recovery use the same transactionally unique admission. */
export function admitDevelopmentRepair(db:Database,userId:string,taskId:string):string|undefined {
  return db.transaction(()=>{
    const existing=db.prepare('SELECT child_run_id FROM copilot_repair_jobs WHERE user_id=? AND failed_task_id=?').get(userId,taskId) as {child_run_id:string}|undefined;
    if(existing)return existing.child_run_id;
    const task=new DevelopmentTaskRepository(db,userId).get(taskId);
    if(!task||task.status!=='checks_failed'||!task.origin_run_id||!task.artifact_digest)return;
    const previous=repairJob(db,userId,task.origin_run_id);
    if(previous?.attempt===2)return;
    const job:RepairJob={id:randomUUID(),user_id:userId,root_task_id:previous?.root_task_id??task.id,failed_task_id:task.id,
      origin_run_id:previous?.origin_run_id??task.origin_run_id,child_run_id:'pending',attempt:(previous?.attempt??0)+1,
      evidence_digest:task.artifact_digest,submission_step_id:null,submitted_task_id:null,report_message_id:null};
    const validated=validateRepairJob(db,userId,job),ledger=new CopilotRunLedger(db,userId);
    const conversation=ledger.log.createConversation(`测试失败修复 ${job.attempt}/2`);
    const child=ledger.admit({userId,conversationId:conversation.id,projectId:task.project_id,executionMode:'repair',parentRunId:job.origin_run_id,
      repairOrigin:{rootTaskId:job.root_task_id,failedTaskId:task.id,attempt:job.attempt,evidenceDigest:job.evidence_digest},
      ...(validated.origin.modelId?{modelId:validated.origin.modelId}:{}),
      userText:'Repair this failed controlled test task. Inspect get_development_task and project evidence. Submit at most ONE corrected immutable development recipe; preserve original sourceFiles, change-path scope and all checks/hashes/test contents. The patch needs fresh owner approval; sandbox checks run afterwards. Never accept, apply to source, dispatch CLI, change tests or delegate.\n'
        +JSON.stringify({rootTaskId:job.root_task_id,failedTaskId:task.id,attempt:job.attempt,originalPlan:validated.plan})},6);
    db.prepare('INSERT INTO copilot_repair_jobs(id,user_id,root_task_id,failed_task_id,origin_run_id,child_run_id,attempt,evidence_digest,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(job.id,userId,job.root_task_id,task.id,job.origin_run_id,child,job.attempt,job.evidence_digest,Date.now());
    // Existing child accounting and cancellation use this common durable relation.
    db.prepare('INSERT INTO copilot_research_jobs(id,user_id,origin_run_id,source_key,conversation_id,child_run_id,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(randomUUID(),userId,job.origin_run_id,`repair:${task.id}`,conversation.id,child,Date.now());
    ledger.log.appendMessage(validated.parent.conversation_id,{role:'assistant',kind:'text',toolName:'development_repair',toolCallId:child,
      content:`测试未通过，已开始第 ${job.attempt}/2 次修复分析。[查看修复与审批](/copilot?c=${conversation.id})。新变更需独立审批；原项目不会被修改。`});
    return child;
  }).immediate();
}

const cursors=new WeakMap<Database,Map<string,number>>();
const reportCursors=new WeakMap<Database,Map<string,number>>();
export function revokeDevelopmentRepairs(db:Database,userId:string,originRunId:string):void {
  db.transaction(()=>{
    originRunId=repairJob(db,userId,originRunId)?.origin_run_id??originRunId;
    const ledger=new CopilotRunLedger(db,userId),parent=ledger.get(originRunId);
    if(!parent)throw new Error('COPILOT_NOT_FOUND');
    db.prepare('UPDATE copilot_runs SET repair_revoked_at=? WHERE user_id=? AND id=?').run(Date.now(),userId,originRunId);
    const jobs=db.prepare('SELECT child_run_id,submitted_task_id FROM copilot_repair_jobs WHERE user_id=? AND origin_run_id=?').all(userId,originRunId) as Array<{child_run_id:string;submitted_task_id:string|null}>;
    const tasks=new DevelopmentTaskRepository(db,userId);
    for(const job of jobs){ledger.cancel(job.child_run_id);const task=job.submitted_task_id?tasks.get(job.submitted_task_id):undefined;
      if(task&&['queued','running'].includes(task.status))tasks.cancel(task.id,task.project_id);}
  }).immediate();
}
export function recoverDevelopmentRepairs(db:Database,userId:string,eventBus?:ForgeBadgerEventBus):void {
  const notify=(runId:string,content:string)=>{
    const parent=new CopilotRunLedger(db,userId).get(runId);
    if(parent)eventBus?.emitEvent({type:'copilot_run_updated',userId,runId,conversationId:parent.conversation_id,
      status:parent.status,source:parent.source,message:content,occurredAt:new Date()});
  };
  let cursor=cursors.get(db);if(!cursor){cursor=new Map();cursors.set(db,cursor);}
  const rows=db.prepare("SELECT rowid position,id FROM copilot_development_tasks WHERE user_id=? AND status='checks_failed' AND rowid>? ORDER BY rowid LIMIT 100")
    .all(userId,cursor.get(userId)??0) as Array<{position:number;id:string}>;
  cursor.set(userId,rows.length===100?rows.at(-1)!.position:0);
  for(const row of rows)try{
    const existed=db.prepare('SELECT 1 FROM copilot_repair_jobs WHERE user_id=? AND failed_task_id=?').get(userId,row.id);
    const child=admitDevelopmentRepair(db,userId,row.id);
    if(child&&!existed){const job=repairJob(db,userId,child)!;notify(job.origin_run_id,'修复分析已开始，请查看新的修复与审批记录。');}
  }catch{/* Revoked/stale origins do not authorize another candidate. */}
  let reportCursor=reportCursors.get(db);if(!reportCursor){reportCursor=new Map();reportCursors.set(db,reportCursor);}
  const jobs=db.prepare('SELECT rowid position,* FROM copilot_repair_jobs WHERE user_id=? AND report_message_id IS NULL AND rowid>? ORDER BY rowid LIMIT 100')
    .all(userId,reportCursor.get(userId)??0) as (RepairJob & {position:number})[];
  reportCursor.set(userId,jobs.length===100?jobs.at(-1)!.position:0);
  for(const job of jobs)try{
    const published=db.transaction(()=>{
      const {parent}=validateRepairJob(db,userId,job),ledger=new CopilotRunLedger(db,userId),child=ledger.get(job.child_run_id);
      const task=job.submitted_task_id?new DevelopmentTaskRepository(db,userId).get(job.submitted_task_id):undefined;
      if(!child||['pending','running','awaiting_approval'].includes(child.status)||task&&['queued','running'].includes(task.status))return;
      const message=ledger.log.appendMessage(parent.conversation_id,{role:'assistant',kind:'text',toolName:'development_repair_result',toolCallId:job.child_run_id,
        content:redactAgentText(`修复 ${job.attempt}/2：${task?.status??child.status}。${task?`测试任务 ${task.id}。`:'未提交新的测试任务。'}${job.attempt===2&&task?.status==='checks_failed'?'已达修复次数上限。':''}测试通过也不代表用户验收或合入；请核对测试回执。`)});
      db.prepare('UPDATE copilot_repair_jobs SET report_message_id=? WHERE user_id=? AND id=? AND report_message_id IS NULL').run(message.id,userId,job.id);
      return message.content;
    }).immediate();
    if(published)notify(job.origin_run_id,published);
  }catch{/* No publication after scope revocation. */}
}
