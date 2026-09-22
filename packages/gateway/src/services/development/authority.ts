import { CopilotToolPreferenceRepository } from '../../db/repositories/copilot-tool-preference-repository.js';
import { PlatformActionRepository } from '../../db/repositories/platform-action-repository.js';
import { ProjectRepository } from '../../db/repositories/project-repository.js';
import type { Database } from '../../db/types.js';
import { assertChannelConversationAuthority } from '../channels/channel-run-authority.js';
import { prepareSource } from './workspace.js';
import { developmentPlanSchema,type DevelopmentTaskRow } from './contracts.js';

export function assertDevelopmentAuthority(db:Database,row:DevelopmentTaskRow,checkSource=true) {
 const active=db.prepare('SELECT status FROM users WHERE id=?').get(row.user_id) as {status:string}|undefined;
 if(active?.status!=='active')throw new Error('DEVELOPMENT_ACTOR_REVOKED');
 const actions=new PlatformActionRepository(db,row.user_id),intent=actions.get(row.intent_id),receipt=actions.receipt(row.intent_id);
 if(!intent||intent.authority!=='owner_action'||intent.grant_id||intent.status!=='completed'||intent.command_id!=='development.task.submit'||intent.expires_at<=Date.now()||intent.policy_version!==1)throw new Error('DEVELOPMENT_AUTHORITY_EXPIRED');
 const result=receipt?.result as {taskId?:string;recipeDigest?:string}|undefined;
 if(receipt?.outcome!=='confirmed'||result?.taskId!==row.id||result.recipeDigest!==row.recipe_digest)throw new Error('DEVELOPMENT_RECEIPT_MISMATCH');
 if(!new CopilotToolPreferenceRepository(db,row.user_id).isEnabled('submit_development_task'))throw new Error('DEVELOPMENT_TOOL_DISABLED');
 if(intent.origin_kind==='copilot') {
  if(!intent.origin_run_id||!intent.origin_step_id||intent.origin_run_id!==row.origin_run_id||intent.origin_step_id!==row.origin_step_id)throw new Error('DEVELOPMENT_ORIGIN_MISSING');
  const origin=db.prepare('SELECT r.status,r.conversation_id,s.tool_name,s.input_json,s.status step_status FROM copilot_run_steps s JOIN copilot_runs r ON r.id=s.run_id AND r.user_id=s.user_id JOIN copilot_conversations c ON c.id=r.conversation_id AND c.user_id=r.user_id WHERE s.user_id=? AND s.id=? AND r.id=?').get(row.user_id,row.origin_step_id,row.origin_run_id) as {status:string;conversation_id:string;tool_name:string;input_json:string;step_status:string}|undefined;
  if(!origin||!['running','completed','awaiting_approval'].includes(origin.status)||origin.tool_name!=='submit_development_task')throw new Error('DEVELOPMENT_ORIGIN_REVOKED');
  if(JSON.stringify(developmentPlanSchema.parse(JSON.parse(origin.input_json)))!==JSON.stringify(JSON.parse(row.plan_json)))throw new Error('DEVELOPMENT_ORIGIN_MISMATCH');
  assertChannelConversationAuthority(db,row.user_id,origin.conversation_id);
 } else if(intent.origin_kind!=='owner_api'||row.origin_run_id||row.origin_step_id)throw new Error('DEVELOPMENT_ORIGIN_MISSING');
 const project=new ProjectRepository(db,row.user_id).getById(row.project_id);
 if(!project)throw new Error('DEVELOPMENT_PROJECT_MISSING');
 if(checkSource){const current=prepareSource(project.path,JSON.parse(row.plan_json));
  if(current.root!==row.project_root||current.sourceDigest!==row.source_digest||current.outputDigest!==row.output_digest||current.recipeDigest!==row.recipe_digest)throw new Error('DEVELOPMENT_SOURCE_DRIFT');
 }
}
