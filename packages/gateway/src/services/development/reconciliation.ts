import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Database } from '../../db/types.js';
import { DevelopmentTaskRepository } from '../../db/repositories/development-task-repository.js';
import { ProjectRepository } from '../../db/repositories/project-repository.js';
import { canonical } from '../platform-commands/actions.js';
import { executionIdentitySchema,executionReservationSchema,systemExecutionObserver,type ExecutionReservation,type ExecutionIdentity,type ExecutionObserver } from './execution-identity.js';
import { evidenceDirectory } from './state-directory.js';
import { hashText } from './workspace.js';
import type { DevelopmentTaskRow } from './contracts.js';

export interface ReconcileInput {projectId:string;taskId:string;expectedRevision:number}
const code=(suffix:string)=>new Error('DEVELOPMENT_RECONCILIATION_'+suffix);
const recordedExecutionSchema=z.discriminatedUnion('phase',[executionReservationSchema,executionIdentitySchema]);
function recordedIdentity(db:Database,row:DevelopmentTaskRow):ExecutionIdentity|ExecutionReservation {
 if(!row.execution_identity_json)throw code('IDENTITY_MISSING');
 let parsed:unknown;try{parsed=JSON.parse(row.execution_identity_json);}catch{throw code('IDENTITY_MISSING');}
 const checked=recordedExecutionSchema.safeParse(parsed);if(!checked.success)throw code('IDENTITY_MISSING');
 const identity=checked.data;
 if(identity.taskId!==row.id||identity.userId!==row.user_id||identity.owner!==row.owner||(identity.phase==='ready'&&identity.supervisorPid!==identity.processGroup)
   ||identity.evidencePath!==path.join(evidenceDirectory(db),identity.nonce+'.json'))throw code('IDENTITY_MISMATCH');
 return identity;
}
function assertStoppedEvidence(identity:ExecutionIdentity):void {
 let fd:number|undefined;
 try {
  fd=fs.openSync(identity.evidencePath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.size>16384||stat.size<2||(stat.mode&0o777)!==0o600||process.getuid&&stat.uid!==process.getuid())throw code('EVIDENCE_INVALID');
  if(fs.realpathSync(identity.evidencePath)!==identity.evidencePath)throw code('EVIDENCE_INVALID');
  const evidence=JSON.parse(fs.readFileSync(fd,'utf8')) as {version?:unknown;identity?:unknown;stopped?:unknown;finishedAt?:unknown};
  if(evidence.version!==1||evidence.stopped!==true||canonical(evidence.identity)!==canonical(identity)
   ||typeof evidence.finishedAt!=='number'||!Number.isSafeInteger(evidence.finishedAt)||evidence.finishedAt<=0||evidence.finishedAt>Date.now()+5000)throw code('EVIDENCE_INVALID');
 }catch(error){if(error instanceof Error&&error.message.startsWith('DEVELOPMENT_RECONCILIATION_'))throw error;throw code('EVIDENCE_UNAVAILABLE');}
 finally{if(fd!==undefined)fs.closeSync(fd);}
}
/** OS observation is independent of lease expiry and never sends signals or requeues work. */
export function reconcileDevelopmentTask(db:Database,userId:string,input:ReconcileInput,observer:ExecutionObserver=systemExecutionObserver):DevelopmentTaskRow {
 const repo=new DevelopmentTaskRepository(db,userId),row=repo.get(input.taskId,input.projectId);
 if(!row||!new ProjectRepository(db,userId).getById(input.projectId))throw code('NOT_FOUND');
 const actor=db.prepare('SELECT status FROM users WHERE id=?').get(userId) as {status:string}|undefined;
 if(actor?.status!=='active')throw code('ACTOR_REVOKED');
 if(row.status!=='indeterminate'||row.revision!==input.expectedRevision)throw code('STALE');
 const identity=recordedIdentity(db,row),observedBoot=z.string().uuid().safeParse(observer.bootIdentity());
 if(!observedBoot.success)throw code('BOOT_IDENTITY_UNAVAILABLE');
 const boot=observedBoot.data.toLowerCase();
 let basis:'supervisor_stopped'|'host_reboot'='host_reboot';
 if(boot===identity.bootIdentity.toLowerCase()){
  if(identity.phase==='reserved')throw code('RESERVATION_UNCONFIRMED');
  assertStoppedEvidence(identity);
  if(observer.groupHasProcesses(identity.processGroup))throw code('STILL_ACTIVE');
  basis='supervisor_stopped';
 }
 return repo.reconcile(row,{version:1,outcome:'unknown',basis,identityDigest:hashText(canonical(identity)),observedAt:Date.now()});
}
export function reconciliationRemedy(codeName:string):string {
 if(codeName==='DEVELOPMENT_RECONCILIATION_RESERVATION_UNCONFIRMED')return 'The execution startup handshake was interrupted on this host boot. Keep it fenced; reboot the host before reconciling the recorded reservation.';
 if(codeName==='DEVELOPMENT_RECONCILIATION_BOOT_IDENTITY_UNAVAILABLE')return 'The current host boot identity is unavailable. Keep the execution fenced until a trustworthy host boot can be observed.';
 if(codeName==='DEVELOPMENT_RECONCILIATION_IDENTITY_MISSING')return 'Legacy execution has no trustworthy process identity. Keep it fenced; use a verified host reset and administrator recovery. Lease expiry or a missing PID is insufficient.';
 if(codeName==='DEVELOPMENT_RECONCILIATION_STALE')return 'Refresh the task and submit its current revision; only indeterminate tasks can be reconciled.';
 if(codeName==='DEVELOPMENT_RECONCILIATION_STILL_ACTIVE')return 'The recorded private process group still has live processes. Wait for the supervisor to finish; reconciliation never kills them.';
 return 'No trustworthy independent stop evidence is available. Keep the task fenced and verify supervisor shutdown, or reboot the host before retrying the recorded execution identity.';
}
