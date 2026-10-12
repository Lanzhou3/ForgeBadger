import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import type {SessionHandle} from './session-handle.js';
export interface DaemonIdentity {pid:number;startedAt:string}
export interface ConfirmedStopReceipt {runtimeName:string;launchNonce:string;daemon:DaemonIdentity;stopped:true}
export interface RuntimeGeneration {runtimeName:string;launchNonce:string;daemon:DaemonIdentity}
export interface ProcessBirth {pid:number;ppid:number;pgid:number;birth:string;nonce:string}
export function groupIsAbsent(pgid:number):boolean {try{process.kill(-pgid,0);return false;}catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH';}}
type BirthObservation = {kind:'observed';birth:ProcessBirth}|{kind:'unavailable'|'mismatch'};
/** Reads only the one known child. Captured process data never enters logs or IPC. */
function observeBirth(pid:number,nonce:string,expected?:ProcessBirth):BirthObservation {
 try{
  if(process.platform==='linux'){
   const stat=readFileSync(`/proc/${pid}/stat`,'utf8'),fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');
   if(fields.length<20||!/^\d+$/.test(fields[19]!)||!Number.isInteger(Number(fields[1]))||Number(fields[1])<=0||!Number.isInteger(Number(fields[2]))||Number(fields[2])<=0)return {kind:'mismatch'};
   const birth={pid,ppid:Number(fields[1]),pgid:Number(fields[2]),birth:fields[19]!,nonce};
   if(expected&&!sameBirth(expected,birth))return {kind:'mismatch'};
   const environment=readFileSync(`/proc/${pid}/environ`,'utf8');
   // exec can temporarily expose an empty environment for the same live PID.
   if(environment.length===0)return {kind:'unavailable'};
   if(!environment.split('\0').includes(`FORGEBADGER_RUNTIME_NONCE=${nonce}`))return {kind:'mismatch'};
   return {kind:'observed',birth};
  }
  if(process.platform==='darwin'){
   const options={encoding:'utf8' as const,timeout:1000,maxBuffer:256*1024,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},stdio:['ignore','pipe','pipe'] as ['ignore','pipe','pipe']};
   const fields=execFileSync('/bin/ps',['-p',String(pid),'-o','pid=,ppid=,pgid=,lstart='],options).trim().split(/\s+/);
   // SIP may hide a system binary's environment. Darwin identity is anchored
   // by the daemon's non-reusable live PID claim plus PPID/PGID/birth checks.
   if(Number(fields[0])!==pid||fields.length<8)return {kind:'mismatch'};
   return {kind:'observed',birth:{pid,ppid:Number(fields[1]),pgid:Number(fields[2]),birth:fields.slice(3).join(' '),nonce}};
  }
 }catch{/* Identity uncertainty prohibits signalling a recycled PID/group. */}
 return {kind:'unavailable'};
}
export function readBirth(pid:number,nonce:string):ProcessBirth|undefined {
 const observation=observeBirth(pid,nonce);
 return observation.kind==='observed'?observation.birth:undefined;
}
function sameBirth(a:ProcessBirth,b:ProcessBirth|undefined){return !!b&&a.pid===b.pid&&a.ppid===b.ppid&&a.pgid===b.pgid&&a.birth===b.birth&&a.nonce===b.nonce;}
export async function confirmHandleStopped(handle:SessionHandle,birth:ProcessBirth|undefined,signal:boolean,isCurrentClaim:()=>boolean):Promise<boolean>{
 const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
 const complete=()=>handle.status==='exited'&&groupIsAbsent(handle.pty.pid);
 if(complete())return true;
 if(!signal)return false;
 const send=async(value:NodeJS.Signals)=>{
  const deadline=Date.now()+200;
  for(let attempt=0;attempt<8;attempt++){
   if(!isCurrentClaim()||handle.status!=='running'||!birth||birth.pid!==birth.pgid||birth.ppid!==process.pid||Date.now()>deadline)return false;
   const observation=observeBirth(birth.pid,birth.nonce,birth);
   if(observation.kind==='mismatch')return false;
   if(observation.kind==='observed'){
    if(!sameBirth(birth,observation.birth))return false;
    try{handle.pty.resume();process.kill(-birth.pgid,value);return true;}catch{return false;}
   }
   if(process.platform!=='linux')return false;
   if(attempt<7)await wait(25);
  }
  return false;
 };
 if(!await send('SIGHUP')){for(let i=0;i<8&&!complete();i++)await wait(25);return complete();}
 for(let i=0;i<20&&!complete();i++)await wait(25);
 if(complete())return true;
 // Never signal a group based only on a reaped leader PID. Descendants that
 // outlive their leader keep this generation pending until the group is gone.
 if(handle.status==='running'&&!await send('SIGKILL'))return false;
 for(let i=0;i<80&&!complete();i++)await wait(25);
 return complete();
}

/** Daemon-side proof: admission or spawn failed before any PTY was created. */
export class SessionNotStartedError extends Error { constructor(readonly runtimeName:string,readonly launchNonce:string){super('SESSION_CREATE_NOT_STARTED');} }
/** Client-side error carrying a strictly validated current-generation receipt. */
export class ConfirmedSessionNotStartedError extends Error { constructor(readonly receipt:ConfirmedStopReceipt){super('SESSION_CREATE_NOT_STARTED');} }

/** Every PTY spawn in this daemon passes through this claim registry. */
export class ProcessClaims {
 private readonly claims=new Map<number,{handle:SessionHandle;nonce:string}>();
 register(handle:SessionHandle,nonce:string):void {this.claims.set(handle.pty.pid,{handle,nonce});}
 owns(handle:SessionHandle,nonce:string):boolean {const claim=this.claims.get(handle.pty.pid);return claim?.handle===handle&&claim.nonce===nonce;}
 release(handle:SessionHandle,nonce:string):void {if(this.owns(handle,nonce))this.claims.delete(handle.pty.pid);}
}
