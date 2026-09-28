/** Trusted Node helper; embedded so the compiled Gateway needs no extra copied asset. */
export const SANDBOX_SUPERVISOR_SOURCE = String.raw`
'use strict';
const {spawn}=require('node:child_process');
const config=JSON.parse(process.argv[1]);
const started=Date.now();
const cap=64*1024;
let used=0,stdout=[],stderr=[],timedOut=false,cancelled=false,finished=false,child;
function capture(target,chunk){const keep=chunk.subarray(0,Math.max(0,cap-used));if(keep.length){used+=keep.length;target.push(keep)}}
function killChild(){if(child&&child.pid){try{process.kill(child.pid,'SIGKILL')}catch{}}}
function cancel(){cancelled=true;killChild()}
function result(code){
 if(finished)return;finished=true;clearTimeout(deadline);
 const data={exitCode:code,stdout:Buffer.concat(stdout).toString('base64'),stderr:Buffer.concat(stderr).toString('base64'),timedOut,cancelled,durationMs:Date.now()-started};
 process.stdout.write(JSON.stringify(data)+'\n',()=>process.exit(0));
}
process.stdout.on('error',()=>{killChild();process.exit(1)});
process.stdin.on('data',()=>cancel());
process.stdin.on('end',()=>cancel());
process.stdin.on('error',()=>cancel());
process.on('SIGTERM',()=>cancel());
process.on('SIGINT',()=>cancel());
const deadline=setTimeout(()=>{timedOut=true;killChild()},config.timeoutMs);
child=spawn('/usr/bin/sandbox-exec',['-p',config.policy,config.node,'--max-old-space-size=128','--test','--experimental-test-isolation=none','--test-reporter=tap','--',...config.checks],{
 cwd:config.workspace,env:config.env,detached:false,stdio:['ignore','pipe','pipe']
});
child.stdout.on('data',chunk=>capture(stdout,chunk));
child.stderr.on('data',chunk=>capture(stderr,chunk));
child.once('error',()=>{capture(stderr,Buffer.from('Sandbox process failed to start'));result(null)});
child.once('close',code=>result(timedOut||cancelled?null:code));
if(cancelled||timedOut)killChild();
`;
