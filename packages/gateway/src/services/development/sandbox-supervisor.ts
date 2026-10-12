/** Trusted Node helper; embedded so the compiled Gateway needs no extra copied asset. */
export const SANDBOX_SUPERVISOR_SOURCE = String.raw`
'use strict';
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const config=JSON.parse(process.argv[1]);
const started=Date.now(),cap=64*1024;
let used=0,stdout=[],stderr=[],timedOut=false,cancelled=false,finished=false,child,identity,deadline,input='';
function capture(target,chunk){const keep=chunk.subarray(0,Math.max(0,cap-used));if(keep.length){used+=keep.length;target.push(keep)}}
function killChild(){if(child&&child.pid){try{process.kill(child.pid,'SIGKILL')}catch{}}}
function stoppedEvidence(){
 if(!identity)return;
 const filename=identity.evidencePath,temp=filename+'.'+process.pid+'.tmp';
 const fd=fs.openSync(temp,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify({version:1,identity,stopped:true,finishedAt:Date.now()}));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
 fs.renameSync(temp,filename);
}
function result(code){
 if(finished)return;finished=true;clearTimeout(deadline);
 try{stoppedEvidence()}catch{process.exit(1);return}
 const data={exitCode:code,stdout:Buffer.concat(stdout).toString('base64'),stderr:Buffer.concat(stderr).toString('base64'),timedOut,cancelled,durationMs:Date.now()-started};
 process.stdout.write(JSON.stringify(data)+'\n',()=>process.exit(0));
}
function cancel(){cancelled=true;if(child)killChild();else result(null)}
function start(){
 if(child||finished)return;
 deadline=setTimeout(()=>{timedOut=true;killChild()},config.timeoutMs);
 child=spawn('/usr/bin/sandbox-exec',['-p',config.policy,config.node,'--max-old-space-size=128','--test','--experimental-test-isolation=none','--test-reporter=tap','--',...config.checks],{
  cwd:config.workspace,env:config.env,detached:false,stdio:['ignore','pipe','pipe']
 });
 child.stdout.on('data',chunk=>capture(stdout,chunk));
 child.stderr.on('data',chunk=>capture(stderr,chunk));
 child.once('error',()=>{capture(stderr,Buffer.from('Sandbox process failed to start'));result(null)});
 child.once('close',code=>result(timedOut||cancelled?null:code));
 if(cancelled||timedOut)killChild();
}
process.stdout.on('error',()=>{killChild();process.exit(1)});
process.stdin.on('data',chunk=>{
 input+=chunk.toString();if(input.length>32768){cancel();return}
 let end;
 while((end=input.indexOf('\n'))>=0){
  const line=input.slice(0,end);input=input.slice(end+1);
  let message;try{message=JSON.parse(line)}catch{cancel();return}
  if(message.kind==='identity'&&!identity&&!child&&config.reservation
    &&message.identity.nonce===config.reservation.nonce&&message.identity.supervisorPid===process.pid&&message.identity.processGroup===process.pid){
   identity=message.identity;process.stdout.write(JSON.stringify({ready:true,nonce:identity.nonce})+'\n');
  }else if(message.kind==='start'&&(!config.reservation||identity)){start()}
  else{cancel()}
 }
});
process.stdin.on('end',()=>cancel());
process.stdin.on('error',()=>cancel());
process.on('SIGTERM',()=>cancel());
process.on('SIGINT',()=>cancel());
// Recorded executions are never started until the Gateway has durably granted go.
if(!config.reservation)start();
`;
