import {z} from 'zod';
import type {Database} from '../types.js';

const daemonSchema=z.object({pid:z.number().int().positive(),startedAt:z.string().datetime()}).strict();
const generationSchema=z.object({runtimeName:z.string().min(1).max(256),launchNonce:z.string().uuid(),daemon:daemonSchema}).strict();
const receiptSchema=generationSchema.extend({stopped:z.literal(true)});
export type RuntimeLaunchGeneration=z.infer<typeof generationSchema>;
export type ConfirmedStopReceipt=z.infer<typeof receiptSchema>;
export interface SessionRuntimeConfirmation extends RuntimeLaunchGeneration {
 userId:string;sessionId:string;status:'pending'|'stopped';receipt:ConfirmedStopReceipt|null;updatedAt:number;
}
interface Row {user_id:string;session_id:string;runtime_name:string;launch_nonce:string;daemon_pid:number;daemon_started_at:string;status:'pending'|'stopped';receipt_json:string|null;updated_at:number}

/** A missing row or registry entry is not a process-exit receipt. */
export class SessionRuntimeConfirmationRepository {
 constructor(private readonly db:Database,private readonly userId:string){}
 get(sessionId:string):SessionRuntimeConfirmation|undefined {
  const row=this.db.prepare('SELECT * FROM session_runtime_confirmations WHERE user_id=? AND session_id=?').get(this.userId,sessionId) as Row|undefined;
  if(!row)return undefined;
  return {userId:row.user_id,sessionId:row.session_id,runtimeName:row.runtime_name,launchNonce:row.launch_nonce,
   daemon:{pid:row.daemon_pid,startedAt:row.daemon_started_at},status:row.status,
   receipt:row.receipt_json?receiptSchema.parse(JSON.parse(row.receipt_json)):null,updatedAt:row.updated_at};
 }
 begin(sessionId:string,input:RuntimeLaunchGeneration):void {
  const generation=generationSchema.parse(input);
  this.db.transaction(()=>{
   const previous=this.get(sessionId);
   if(previous?.status==='pending'){
    if(this.matches(previous,generation))return;
    throw new Error('SESSION_RUNTIME_STOP_UNCONFIRMED');
   }
   if(previous?.launchNonce===generation.launchNonce)throw new Error('SESSION_RUNTIME_GENERATION_REUSED');
   this.db.prepare(`INSERT INTO session_runtime_confirmations(user_id,session_id,runtime_name,launch_nonce,daemon_pid,daemon_started_at,status,receipt_json,updated_at)
    VALUES(?,?,?,?,?,?,'pending',NULL,?) ON CONFLICT(user_id,session_id) DO UPDATE SET runtime_name=excluded.runtime_name,launch_nonce=excluded.launch_nonce,
    daemon_pid=excluded.daemon_pid,daemon_started_at=excluded.daemon_started_at,status='pending',receipt_json=NULL,updated_at=excluded.updated_at`)
    .run(this.userId,sessionId,generation.runtimeName,generation.launchNonce,generation.daemon.pid,generation.daemon.startedAt,Date.now());
  })();
 }
 confirm(sessionId:string,expectedLaunchNonce:string,input:ConfirmedStopReceipt):boolean {
  const receipt=receiptSchema.parse(input),current=this.get(sessionId);
  if(!current||current.launchNonce!==expectedLaunchNonce||!this.matches(current,receipt))return false;
  return this.db.prepare(`UPDATE session_runtime_confirmations SET status='stopped',receipt_json=?,updated_at=?
   WHERE user_id=? AND session_id=? AND launch_nonce=? AND runtime_name=? AND daemon_pid=? AND daemon_started_at=?`)
   .run(JSON.stringify(receipt),Date.now(),this.userId,sessionId,expectedLaunchNonce,receipt.runtimeName,receipt.daemon.pid,receipt.daemon.startedAt).changes===1;
 }
 private matches(a:RuntimeLaunchGeneration,b:RuntimeLaunchGeneration):boolean {
  return a.runtimeName===b.runtimeName&&a.launchNonce===b.launchNonce&&a.daemon.pid===b.daemon.pid&&a.daemon.startedAt===b.daemon.startedAt;
 }
}

/** Also used by repositories backed by pre-confirmation fixture schemas. */
export function assertRuntimeDeletionConfirmed(db:Database,userId:string,scope:'session'|'project',id:string):void {
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_runtime_confirmations'").get())return;
 const pending=scope==='session'
  ?db.prepare("SELECT 1 FROM session_runtime_confirmations WHERE user_id=? AND session_id=? AND status='pending'").get(userId,id)
  :db.prepare("SELECT 1 FROM session_runtime_confirmations c JOIN sessions s ON s.user_id=c.user_id AND s.id=c.session_id WHERE c.user_id=? AND s.project_id=? AND c.status='pending'").get(userId,id);
 if(pending)throw new Error('SESSION_RUNTIME_STOP_UNCONFIRMED');
}
