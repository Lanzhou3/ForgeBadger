import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Database } from '../../db/types.js';
import { DevelopmentTaskRepository } from '../../db/repositories/development-task-repository.js';
import type { ForgeBadgerEventBus } from '../event-bus.js';
import { redactAgentErrorMessage,redactAgentValue } from '../agent/redaction.js';
import { assertDevelopmentAuthority } from './authority.js';
import { prepareSource,writeWorkspace,assertWorkspace,sourceDiff,hashText } from './workspace.js';
import { runSandboxChecks } from './sandbox.js';
import type { DevelopmentTaskRow,DevelopmentEvidence } from './contracts.js';

interface Dependencies {db:Database;eventBus:ForgeBadgerEventBus;}
const liveWorkers=new WeakMap<Database,Map<string,{controller:AbortController;promise:Promise<void>}>>();
const bases=new WeakMap<Database,string>();
function workspaceBase(db:Database) {
 let base=bases.get(db);if(base)return base;
 base=db.name&&db.name!==':memory:'?path.join(fs.realpathSync(path.dirname(path.resolve(db.name))),'development-workspaces'):fs.mkdtempSync(path.join(os.tmpdir(),'forgebadger-development-'));
 fs.mkdirSync(base,{recursive:true,mode:0o700});if(fs.lstatSync(base).isSymbolicLink())throw new Error('DEVELOPMENT_ROOT_SYMLINK');fs.chmodSync(base,0o700);bases.set(db,base);return base;
}
export function startDevelopmentRuntime(deps:Dependencies) {
 const workers=liveWorkers.get(deps.db)??new Map();liveWorkers.set(deps.db,workers);let stopped=false;
 function pump() {
  if(stopped||!deps.db.open)return;
  const users=deps.db.prepare('SELECT id FROM users').all() as {id:string}[];
  for(const user of users){const repo=new DevelopmentTaskRepository(deps.db,user.id);repo.recover();
   for(const event of repo.pendingEvents()) {try {deps.eventBus.emitEvent({type:'copilot_development_updated',userId:user.id,taskId:event.task_id,status:event.status,revision:event.revision,eventId:event.id});repo.delivered(event.id);}catch{/* Durable outbox retains event for next tick. */}}
   if(workers.size)continue;
   const row=repo.claim(randomUUID());if(!row)continue;
   const controller=new AbortController();const promise=Promise.resolve().then(()=>executeTask(deps,row,controller)).catch(error=>{controller.abort();reportFailure('worker',error,row);}).finally(()=>workers.delete(row.id));
   workers.set(row.id,{controller,promise});
  }
 }
 function tick() {
  try {pump();} catch(error) {
   for(const worker of workers.values())worker.controller.abort();
   reportFailure('queue',error);
  }
 }
 const timer=setInterval(tick,1000);timer.unref();const ready=Promise.resolve().then(tick);
 async function stop(){stopped=true;clearInterval(timer);for(const w of workers.values())w.controller.abort();await Promise.allSettled([...workers.values()].map(w=>w.promise));}
 return {ready,stop,tick};
}
function reportFailure(action:string,error:unknown,row?:DevelopmentTaskRow) {
 console.error('[copilot development]',{action,userId:row?.user_id,taskId:row?.id,timestamp:new Date().toISOString(),error:redactAgentErrorMessage(error instanceof Error?error.message:'Development storage unavailable')});
}
async function executeTask(deps:Dependencies,row:DevelopmentTaskRow,controller:AbortController) {
 const repo=new DevelopmentTaskRepository(deps.db,row.user_id);const owner=row.owner!;let error:string|undefined;
 const authorize=()=>{if(!deps.db.open||!repo.owns(row.id,owner))throw new Error('DEVELOPMENT_EXECUTION_CANCELLED');assertDevelopmentAuthority(deps.db,row,false);};
 const timer=setInterval(()=>{try {authorize();if(!repo.renew(row.id,owner))throw new Error('DEVELOPMENT_LEASE_LOST');}catch(e){error=redactAgentErrorMessage(e instanceof Error?e.message:'Development authority unavailable');controller.abort();}},500);timer.unref();
 try {
  authorize();assertDevelopmentAuthority(deps.db,row);const prepared=prepareSource(row.project_root,JSON.parse(row.plan_json));
  const directory=path.join(workspaceBase(deps.db),hashText(row.user_id).slice(0,16)+'-'+row.id);
  writeWorkspace(directory,prepared);repo.setWorkspace(row.id,owner,directory);assertWorkspace(directory,prepared);
  const evidence:DevelopmentEvidence={sourceDigest:row.source_digest,outputDigest:row.output_digest,recipeDigest:row.recipe_digest,files:prepared.plan.changes.map(c=>({path:c.path,beforeSha256:c.beforeSha256,afterSha256:prepared.after.has(c.path)?hashText(prepared.after.get(c.path)!):null})),diff:sourceDiff(prepared),checks:[],startedAt:Date.now(),finishedAt:0};
  for(const check of prepared.plan.checks) {
   authorize();if(controller.signal.aborted)throw new Error('DEVELOPMENT_EXECUTION_CANCELLED');
   const remaining=60000-(Date.now()-evidence.startedAt);if(remaining<=0)throw new Error('DEVELOPMENT_DEADLINE');
   const result=await runSandboxChecks({workspace:directory,checks:[check.path],signal:controller.signal,timeoutMs:remaining});
   evidence.checks.push({path:check.path,...result});if(result.exitCode!==0||result.cancelled||result.timedOut)break;
  }
  authorize();assertDevelopmentAuthority(deps.db,row);assertWorkspace(directory,prepared);evidence.finishedAt=Date.now();
  const passed=evidence.checks.length===prepared.plan.checks.length&&evidence.checks.every(c=>c.exitCode===0&&!c.cancelled&&!c.timedOut);
  repo.finish(row.id,owner,passed?'checks_passed':'checks_failed',redactAgentValue(evidence) as DevelopmentEvidence);
 } catch(e) {
  if(deps.db.open)repo.finish(row.id,owner,controller.signal.aborted&&!error?'cancelled':'failed',undefined,error??redactAgentErrorMessage(e instanceof Error?e.message:'Development execution failed'));
 } finally {clearInterval(timer);}
}
