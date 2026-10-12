import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { Database } from '../../db/types.js';
import { evidenceDirectory } from './state-directory.js';

const uuid=z.string().uuid();
export const executionReservationSchema=z.object({version:z.literal(1),phase:z.literal('reserved'),userId:z.string().min(1),taskId:z.string().min(1),owner:z.string().min(1),nonce:uuid,bootIdentity:uuid,evidencePath:z.string().min(1).max(4096)}).strict();
export const executionIdentitySchema=executionReservationSchema.extend({phase:z.literal('ready'),supervisorPid:z.number().int().min(2),processGroup:z.number().int().min(2),startIdentity:z.string().min(1).max(128)}).strict();
export type ExecutionReservation=z.infer<typeof executionReservationSchema>;
export type ExecutionIdentity=z.infer<typeof executionIdentitySchema>;
export interface ExecutionObserver {bootIdentity():string;groupHasProcesses(group:number):boolean}

export function hostBootIdentity():string {
 if(process.platform!=='darwin')throw new Error('DEVELOPMENT_RECONCILIATION_OS_UNSUPPORTED');
 const value=execFileSync('/usr/sbin/sysctl',['-n','kern.bootsessionuuid'],{encoding:'utf8',timeout:2000,maxBuffer:4096}).trim().toLowerCase();
 return uuid.parse(value);
}
export function executionReservation(db:Database,userId:string,taskId:string,owner:string):ExecutionReservation {
 const nonce=randomUUID();return {version:1,phase:'reserved',userId,taskId,owner,nonce,bootIdentity:hostBootIdentity(),evidencePath:path.join(evidenceDirectory(db),nonce+'.json')};
}
export function identifySupervisor(pid:number,reservation:ExecutionReservation):ExecutionIdentity {
 const output=execFileSync('/bin/ps',['-p',String(pid),'-o','pid=,pgid=,lstart=,command='],{encoding:'utf8',timeout:2000,maxBuffer:65536}).trim();
 const match=/^(\d+)\s+(\d+)\s+(.{24})\s+([\s\S]+)$/u.exec(output);
 if(!match||Number(match[1])!==pid||Number(match[2])!==pid||!match[4]!.includes(reservation.nonce))throw new Error('DEVELOPMENT_SUPERVISOR_IDENTITY_UNAVAILABLE');
 return executionIdentitySchema.parse({...reservation,phase:'ready',supervisorPid:pid,processGroup:pid,startIdentity:match[3]!.trim()});
}
export const systemExecutionObserver:ExecutionObserver={
 bootIdentity:hostBootIdentity,
 groupHasProcesses(group){
  const output=execFileSync('/bin/ps',['-axo','pgid='],{encoding:'utf8',timeout:2000,maxBuffer:4*1024*1024});
  return output.split('\n').some(line=>Number(line.trim())===group);
 }
};
