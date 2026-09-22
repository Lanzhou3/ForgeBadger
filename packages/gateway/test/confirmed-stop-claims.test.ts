import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {IPty} from 'node-pty';
import {SessionHandle} from '../src/services/session-server/session-handle.js';
import {ProcessClaims,confirmHandleStopped} from '../src/services/session-server/confirmed-stop.js';

test('PID reuse invalidates an old handle claim even if the OS birth fields look identical',async(t)=>{
 const pty={pid:4242,cols:80,rows:24,pause(){},resume(){},kill(){},write(){},resize(){},onData(){return {dispose(){}};},onExit(){return {dispose(){}};}} as unknown as IPty;
 const old=new SessionHandle({sessionId:'same-runtime',userId:'fixture',attachToken:'old',pty}),fresh=new SessionHandle({sessionId:'same-runtime',userId:'fixture',attachToken:'fresh',pty}),claims=new ProcessClaims();let signals=0;
 t.mock.method(process,'kill',()=>{signals++;return true;});
 try{
  claims.register(old,'old-nonce');assert.equal(claims.owns(old,'old-nonce'),true);
  claims.register(fresh,'fresh-nonce');assert.equal(claims.owns(old,'old-nonce'),false);
  claims.release(old,'old-nonce');assert.equal(claims.owns(fresh,'fresh-nonce'),true);
  assert.equal(await confirmHandleStopped(old,{pid:4242,ppid:process.pid,pgid:4242,birth:'same-second-birth',nonce:'old-nonce'},true,()=>claims.owns(old,'old-nonce')),false);
  assert.equal(signals,0,'old generation must not even probe/signal the replacement process');
 }finally{old.disposeResources();fresh.disposeResources();}
});
