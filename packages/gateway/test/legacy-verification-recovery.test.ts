import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,realpathSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {getVerificationProcessState,recoverVerificationProcess,assertVerificationProcessStopped} from '../src/services/collaboration/legacy-verification-recovery.js';
function fixture() {
 const root=realpathSync(mkdtempSync(path.join(tmpdir(),'fb-legacy-verification-'))),cwd=path.join(root,'workspace');mkdirSync(cwd);
 const directory=path.join(root,'.verification-state',createHash('sha256').update(cwd).digest('hex').slice(0,32));
 mkdirSync(path.dirname(directory),{mode:0o700});mkdirSync(directory,{mode:0o700});
 const id=randomBytes(16).toString('hex'),state={version:1,id,cwd,token:randomBytes(32).toString('hex'),endpoint:path.join(realpathSync(tmpdir()),'.fbv-test-'+id.slice(0,12)),phase:'running',stopped:false};
 const write=()=>{writeFileSync(path.join(directory,'current.json'),JSON.stringify({id}),{mode:0o600});writeFileSync(path.join(directory,`state-${id}.json`),JSON.stringify(state),{mode:0o600});};
 return {root,cwd,directory,state,write,close(){rmSync(root,{recursive:true,force:true});rmSync(state.endpoint,{force:true});}};
}
test('missing legacy runtime needs no action; unresolved or corrupt identity remains fenced',async()=>{
 const f=fixture();try {
  assert.equal((await getVerificationProcessState(f)).safeToProceed,true);f.write();
  assert.equal((await recoverVerificationProcess(f)).safeToProceed,false);
  await assert.rejects(assertVerificationProcessStopped(f),{code:"VERIFICATION_RUNTIME_UNRESOLVED"});
  writeFileSync(path.join(f.directory,'current.json'),'invalid json');
  assert.equal((await recoverVerificationProcess(f)).safeToProceed,false);
 }finally{f.close();}
});
test('only a finished and stopped historical receipt permits release',async()=>{
 const f=fixture();try {
  f.state.phase='uncertain';f.state.stopped=true;f.write();assert.equal((await getVerificationProcessState(f)).safeToProceed,false);
  f.state.phase='finished';f.state.stopped=false;f.write();assert.equal((await getVerificationProcessState(f)).safeToProceed,false);
  f.state.stopped=true;f.write();assert.equal((await recoverVerificationProcess(f)).safeToProceed,true);
 }finally{f.close();}
});
test('legacy cancellation authenticates supervisor and waits for persisted stop proof',async()=>{
 const f=fixture();f.write();let cancelled=false;
 const mac=(text:string)=>createHmac('sha256',f.state.token).update(text).digest('hex');
 const server=net.createServer(socket=>socket.on('data',raw=>{
  const request=JSON.parse(String(raw));assert.equal(request.mac,mac(`${f.state.id}:${request.op}:${request.challenge}`));
  if(request.op==='cancel'){cancelled=true;f.state.phase='finished';f.state.stopped=true;f.write();}
  const payload={id:f.state.id,phase:f.state.phase,stopped:f.state.stopped};socket.end(JSON.stringify({payload,mac:mac(`${request.challenge}:${JSON.stringify(payload)}`)})+'\n');
 }));
 await new Promise<void>(resolve=>server.listen(f.state.endpoint,resolve));
 try{assert.equal((await recoverVerificationProcess(f)).safeToProceed,true);assert.equal(cancelled,true);}
 finally{await new Promise<void>(resolve=>server.close(()=>resolve()));f.close();}
});
test('an unauthenticated replacement endpoint cannot clear old execution fences',async()=>{
 const f=fixture();f.write();const server=net.createServer(socket=>socket.on('data',()=>socket.end(JSON.stringify({payload:{id:f.state.id,phase:'finished',stopped:true},mac:'0'.repeat(64)})+'\n')));
 await new Promise<void>(resolve=>server.listen(f.state.endpoint,resolve));
 try{assert.equal((await recoverVerificationProcess(f)).safeToProceed,false);}
 finally{await new Promise<void>(resolve=>server.close(()=>resolve()));f.close();}
});
