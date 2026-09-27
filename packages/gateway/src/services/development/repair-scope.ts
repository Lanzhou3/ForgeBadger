import type { Database } from '../../db/types.js';
import type { TurnInput } from '../agent/run-ledger.js';
import { DevelopmentTaskRepository } from '../../db/repositories/development-task-repository.js';
import { ProjectRepository } from '../../db/repositories/project-repository.js';
import { assertChannelConversationAuthority } from '../channels/channel-run-authority.js';
import { assertDevelopmentAuthority } from './authority.js';
import { developmentPlanSchema, type DevelopmentEvidence } from './contracts.js';
import { prepareSource, hashText } from './workspace.js';

export interface RepairJob { id:string; user_id:string; root_task_id:string; failed_task_id:string; origin_run_id:string;
  child_run_id:string; attempt:number; evidence_digest:string; submission_step_id:string|null; submitted_task_id:string|null; report_message_id:string|null }
export function repairJob(db:Database,userId:string,runId:string):RepairJob|undefined {
  return db.prepare('SELECT * FROM copilot_repair_jobs WHERE user_id=? AND child_run_id=?').get(userId,runId) as RepairJob|undefined;
}
export function validateRepairJob(db:Database,userId:string,job:RepairJob) {
  const tasks=new DevelopmentTaskRepository(db,userId),root=tasks.get(job.root_task_id),failed=tasks.get(job.failed_task_id);
  const parent=db.prepare('SELECT input_json,status,conversation_id,repair_revoked_at FROM copilot_runs WHERE user_id=? AND id=?').get(userId,job.origin_run_id) as {input_json:string;status:string;conversation_id:string;repair_revoked_at:number|null}|undefined;
  const origin:TurnInput|undefined=parent?JSON.parse(parent.input_json):undefined;
  if(!root||!failed||!parent||parent.repair_revoked_at||!origin?.repairFailedChecks||origin.executionMode||origin.source&&origin.source!=='user'
    ||!['running','completed','awaiting_approval'].includes(parent.status)||root.origin_run_id!==job.origin_run_id
    ||root.project_id!==failed.project_id||origin.projectId&&origin.projectId!==root.project_id
    ||job.attempt<1||job.attempt>2) throw new Error('COPILOT_REPAIR_ORIGIN_REVOKED');
  const authorization=db.prepare(`SELECT m.id FROM copilot_messages m
    JOIN copilot_conversations c ON c.id=m.conversation_id AND c.user_id=m.user_id
    WHERE m.user_id=? AND m.conversation_id=? AND c.status='active' AND m.role='user' AND m.kind='text'
      AND m.content=? AND (m.run_id=? OR m.id=?) LIMIT 1`)
    .get(userId,parent.conversation_id,origin.userText,job.origin_run_id,origin.editMessageId??null);
  if(!authorization)throw new Error('COPILOT_REPAIR_ORIGIN_REVOKED');
  assertChannelConversationAuthority(db,userId,parent.conversation_id);
  if(!new ProjectRepository(db,userId).getCopilotAutonomy(root.project_id)) throw new Error('COPILOT_REPAIR_AUTONOMY_OFF');
  if(job.attempt===1 && root.id!==failed.id)throw new Error('COPILOT_REPAIR_CHAIN_MISMATCH');
  if(job.attempt===2) {
    const previous=failed.origin_run_id?repairJob(db,userId,failed.origin_run_id):undefined;
    if(!previous||previous.attempt!==1||previous.root_task_id!==root.id||previous.submitted_task_id!==failed.id)throw new Error('COPILOT_REPAIR_CHAIN_MISMATCH');
  }
  assertDevelopmentAuthority(db,root);
  if(failed.id!==root.id)assertDevelopmentAuthority(db,failed);
  if(failed.status!=='checks_failed'||!failed.evidence_json||hashText(failed.evidence_json)!==failed.artifact_digest
    ||failed.artifact_digest!==job.evidence_digest)throw new Error('COPILOT_REPAIR_EVIDENCE_CHANGED');
  const evidence=JSON.parse(failed.evidence_json) as DevelopmentEvidence,plan=developmentPlanSchema.parse(JSON.parse(root.plan_json));
  if(evidence.sourceDigest!==failed.source_digest||evidence.outputDigest!==failed.output_digest||evidence.recipeDigest!==failed.recipe_digest
    ||!evidence.checks.length||evidence.checks.length>plan.checks.length
    ||evidence.checks.some((check,index)=>check.path!==plan.checks[index]?.path||check.cancelled||check.timedOut)
    ||!evidence.checks.some(check=>check.exitCode!==null&&check.exitCode!==0)) throw new Error('COPILOT_REPAIR_NO_FAILED_CHECK');
  return {root,failed,origin,parent,plan};
}

export function assertRepairPlan(db:Database,userId:string,runId:string,stepId:string,raw:unknown):RepairJob|undefined {
  const job=repairJob(db,userId,runId);if(!job)return undefined;
  const {root,plan}=validateRepairJob(db,userId,job),next=developmentPlanSchema.parse(raw);
  if(job.submission_step_id && job.submission_step_id!==stepId)throw new Error('COPILOT_REPAIR_SUBMISSION_LIMIT');
  if(next.projectId!==root.project_id||JSON.stringify(next.sourceFiles)!==JSON.stringify(plan.sourceFiles)
    ||JSON.stringify(next.checks)!==JSON.stringify(plan.checks)
    ||next.changes.some(change=>!plan.changes.some(original=>original.path===change.path))) throw new Error('COPILOT_REPAIR_SCOPE_CHANGED');
  for(const check of plan.checks) {
    const expected=plan.changes.find(change=>change.path===check.path),actual=next.changes.find(change=>change.path===check.path);
    if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error('COPILOT_REPAIR_TEST_CHANGED');
  }
  const prepared=prepareSource(root.project_root,next);
  if(prepared.root!==root.project_root||prepared.sourceDigest!==root.source_digest)throw new Error('COPILOT_REPAIR_SOURCE_DRIFT');
  return job;
}

export function reserveRepairSubmission(db:Database,userId:string,runId:string,stepId:string,raw:unknown):void {
  db.transaction(()=>{
    const job=assertRepairPlan(db,userId,runId,stepId,raw);
    if(!job)throw new Error('COPILOT_REPAIR_ORIGIN_MISSING');
    db.prepare('UPDATE copilot_repair_jobs SET submission_step_id=? WHERE user_id=? AND id=? AND submission_step_id IS NULL').run(stepId,userId,job.id);
  }).immediate();
}
