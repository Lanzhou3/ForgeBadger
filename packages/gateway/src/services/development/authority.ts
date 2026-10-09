import { repairJob, validateRepairJob, assertRepairPlan } from './repair-scope.js';
import { CopilotToolPreferenceRepository } from '../../db/repositories/copilot-tool-preference-repository.js';
import { PlatformActionRepository } from '../../db/repositories/platform-action-repository.js';
import { ProjectRepository } from '../../db/repositories/project-repository.js';
import type { Database } from '../../db/types.js';
import { assertChannelConversationAuthority } from '../channels/channel-run-authority.js';
import { prepareSource,hashText } from './workspace.js';
import { developmentPlanSchema,type DevelopmentTaskRow } from './contracts.js';
import { canonical } from '../platform-commands/actions.js';
import { realpathSync } from 'node:fs';
import type { TurnInput } from '../agent/run-ledger.js';
import { hasUserMessageAuthorization, projectAutonomyEnabled } from '../agent/run-authorization.js';
import { assertChannelRunScope } from '../channels/channel-run-scope.js';

/** Cheap liveness/revocation probe for the 500ms lease timer: indexed DB reads only — no plan
 *  parsing, digest canonicalization, fs realpaths, or transactions. Every invariant skipped here
 *  is re-verified in full by assertDevelopmentAuthority before/after checks and at acceptance. */
export function assertDevelopmentAuthorityCheap(db:Database,row:DevelopmentTaskRow) {
 const active=db.prepare('SELECT status FROM users WHERE id=?').get(row.user_id) as {status:string}|undefined;
 if(active?.status!=='active')throw new Error('DEVELOPMENT_ACTOR_REVOKED');
 const live=db.prepare('SELECT status,owner,lease_expires_at,cancel_requested FROM copilot_development_tasks WHERE user_id=? AND id=?').get(row.user_id,row.id) as {status:string;owner:string|null;lease_expires_at:number|null;cancel_requested:number}|undefined;
 if(!live||live.status!=='running'||live.owner!==row.owner||live.cancel_requested||(live.lease_expires_at??0)<=Date.now())throw new Error('DEVELOPMENT_LEASE_LOST');
 if(!new CopilotToolPreferenceRepository(db,row.user_id).isEnabled('submit_development_task'))throw new Error('DEVELOPMENT_TOOL_DISABLED');
 if(row.origin_run_id&&row.origin_step_id) {
  if(!projectAutonomyEnabled(db,row.user_id,row.project_id))throw new Error('DEVELOPMENT_AUTONOMY_OFF');
  const origin=db.prepare("SELECT s.status step_status,r.status run_status FROM copilot_run_steps s JOIN copilot_runs r ON r.id=s.run_id AND r.user_id=s.user_id WHERE s.user_id=? AND s.id=? AND r.id=?").get(row.user_id,row.origin_step_id,row.origin_run_id) as {step_status:string;run_status:string}|undefined;
  if(!origin||!['running','completed'].includes(origin.step_status)||!['running','completed','awaiting_approval'].includes(origin.run_status))throw new Error('DEVELOPMENT_ORIGIN_REVOKED');
 } else if(row.origin_run_id||row.origin_step_id)throw new Error('DEVELOPMENT_ORIGIN_MISSING');
}

export function assertDevelopmentAuthority(db:Database,row:DevelopmentTaskRow,checkSource=true) {
 const active=db.prepare('SELECT status FROM users WHERE id=?').get(row.user_id) as {status:string}|undefined;
 if(active?.status!=='active')throw new Error('DEVELOPMENT_ACTOR_REVOKED');
 const actions=new PlatformActionRepository(db,row.user_id),intent=actions.get(row.intent_id),receipt=actions.receipt(row.intent_id);
 // A consumed, confirmed admission is a task identity, not a renewable TTL grant.
 if(!intent||intent.authority!=='owner_action'||intent.status!=='completed'||intent.command_id!=='development.task.submit'||intent.actor_user_id!==row.user_id||intent.policy_version!==1)throw new Error('DEVELOPMENT_AUTHORITY_MISMATCH');
 const result=receipt?.result as {taskId?:string;recipeDigest?:string}|undefined;
 if(receipt?.outcome!=='confirmed'||result?.taskId!==row.id||result.recipeDigest!==row.recipe_digest)throw new Error('DEVELOPMENT_RECEIPT_MISMATCH');
 const plan=developmentPlanSchema.parse(JSON.parse(row.plan_json));
 const resources={projectIds:[row.project_id],rootPaths:[row.project_root],revision:hashText(JSON.stringify([row.project_root,row.source_digest,row.output_digest,row.recipe_digest]))};
 if(plan.projectId!==row.project_id||plan.goal!==row.goal||canonical(plan)!==intent.input_json||canonical(resources)!==intent.resources_json
   ||hashText(canonical({commandId:intent.command_id,input:plan,resources,policyVersion:1}))!==intent.digest)throw new Error('DEVELOPMENT_AUTHORITY_MISMATCH');
 if(!new CopilotToolPreferenceRepository(db,row.user_id).isEnabled('submit_development_task'))throw new Error('DEVELOPMENT_TOOL_DISABLED');
 if(intent.origin_kind==='copilot') {
  if(!intent.origin_run_id||!intent.origin_step_id||intent.origin_run_id!==row.origin_run_id||intent.origin_step_id!==row.origin_step_id)throw new Error('DEVELOPMENT_ORIGIN_MISSING');
  const origin=db.prepare("SELECT r.status,r.source,r.input_json run_input_json,r.conversation_id,s.tool_name,s.input_json,s.input_digest,s.status step_status FROM copilot_run_steps s JOIN copilot_runs r ON r.id=s.run_id AND r.user_id=s.user_id JOIN copilot_conversations c ON c.id=r.conversation_id AND c.user_id=r.user_id AND c.status='active' WHERE s.user_id=? AND s.id=? AND r.id=? AND s.kind='tool'").get(row.user_id,row.origin_step_id,row.origin_run_id) as {status:string;source:string;run_input_json:string;conversation_id:string;tool_name:string;input_json:string;input_digest:string;step_status:string}|undefined;
  if(!origin||!['running','completed','awaiting_approval'].includes(origin.status)||origin.tool_name!=='submit_development_task')throw new Error('DEVELOPMENT_ORIGIN_REVOKED');
  if(!['running','completed'].includes(origin.step_status)||intent.idempotency_key!==row.origin_step_id||hashText(origin.input_json)!==origin.input_digest||canonical(developmentPlanSchema.parse(JSON.parse(origin.input_json)))!==canonical(plan))throw new Error('DEVELOPMENT_ORIGIN_MISMATCH');
  const input=JSON.parse(origin.run_input_json) as TurnInput;
  if(input.userId!==row.user_id||input.conversationId!==origin.conversation_id||(input.source??'user')!==origin.source
    ||!['user','reactive','scheduled'].includes(origin.source)||input.projectId&&input.projectId!==row.project_id)throw new Error('DEVELOPMENT_ORIGIN_MISMATCH');
  if(origin.source==='user'&&!input.executionMode&&!hasUserMessageAuthorization(db,row.user_id,origin.conversation_id,input.userText,row.origin_run_id!,input.editMessageId))throw new Error('DEVELOPMENT_ORIGIN_REVOKED');
  assertChannelConversationAuthority(db,row.user_id,origin.conversation_id);
  assertChannelRunScope(db,row.user_id,input,{projectIds:[row.project_id],rootPaths:[row.project_root]});
  const repair=repairJob(db,row.user_id,row.origin_run_id!);
  if(repair){validateRepairJob(db,row.user_id,repair);assertRepairPlan(db,row.user_id,row.origin_run_id!,row.origin_step_id!,JSON.parse(row.plan_json));
    if(repair.submitted_task_id!==row.id)throw new Error('COPILOT_REPAIR_SUBMISSION_MISMATCH');}

 } else if(intent.origin_kind!=='owner_api'||row.origin_run_id||row.origin_step_id)throw new Error('DEVELOPMENT_ORIGIN_MISSING');
 const projects=new ProjectRepository(db,row.user_id),project=projects.getById(row.project_id);
 if(!project)throw new Error('DEVELOPMENT_PROJECT_MISSING');
 if(intent.origin_kind==='copilot'&&!projectAutonomyEnabled(db,row.user_id,row.project_id))throw new Error('DEVELOPMENT_AUTONOMY_OFF');
 if(realpathSync(project.path)!==row.project_root)throw new Error('DEVELOPMENT_SOURCE_DRIFT');
 if(checkSource){const current=prepareSource(project.path,JSON.parse(row.plan_json));
  if(current.root!==row.project_root||current.sourceDigest!==row.source_digest||current.outputDigest!==row.output_digest||current.recipeDigest!==row.recipe_digest)throw new Error('DEVELOPMENT_SOURCE_DRIFT');
 }
}
