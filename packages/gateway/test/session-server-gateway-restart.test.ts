import assert from 'node:assert/strict';
import { it } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { SessionServerClient } from '../src/services/session-server-client.js';
import { createPlatformAdapter } from '../src/services/session-server/platform-adapter.js';
import { resolveSessionServerTokenPath } from '../src/services/session-server/auth-token.js';

interface Ready {port:number;token:string;status:string}
const delay = (ms:number) => new Promise(r=>setTimeout(r,ms));
async function waitUntil(test:()=>boolean, timeout=15000) {
  const deadline=Date.now()+timeout;
  while(!test()) { if(Date.now()>deadline) throw new Error('fixture wait timeout'); await delay(20); }
}
async function stop(child:ChildProcess) {
  if(child.exitCode!==null || child.signalCode!==null) return;
  child.kill('SIGTERM');
  try { await waitUntil(()=>child.exitCode!==null || child.signalCode!==null,5000); }
  catch { child.kill('SIGKILL'); await waitUntil(()=>child.signalCode!==null); }
}
it('real Gateway processes reuse the default daemon and PTY; cold restart marks missing sessions lost', {timeout:60000}, async()=> {
  const root=await mkdtemp(join(tmpdir(),'fb-gw-life-'));
  const children:ChildProcess[]=[];
  const sockets:WebSocket[]=[];
  let client:SessionServerClient|undefined;
  async function gateway(create=false):Promise<{child:ChildProcess;ready:Ready}> {
    const child=spawn(process.execPath,['--import','tsx',fileURLToPath(new URL('./fixtures/session-server-gateway.fixture.ts',import.meta.url))],{env:{...process.env,FB_TEST_STATE:root,FB_TEST_CREATE:create?'1':'0'},stdio:['ignore','pipe','pipe']});
    children.push(child);
    let output='';let errors='';let ready:Ready|undefined;
    child.stdout!.on('data',chunk=>{output+=String(chunk);const line=output.split('\n').find(l=>l.startsWith('FIXTURE_READY='));if(line)ready=JSON.parse(line.slice(14));});
    child.stderr!.on('data',chunk=>{errors+=String(chunk);});
    await waitUntil(()=>{if(child.exitCode!==null)throw new Error(`Gateway exited: ${errors}`);return !!ready;});
    return {child,ready:ready!};
  }
  async function attach(ready:Ready) {
    const ws=new WebSocket(`ws://127.0.0.1:${ready.port}/ws/terminal/s1`,['forgebadger-terminal',ready.token,'attach-test']);
    sockets.push(ws);let output='';let acknowledge=true;let lastSequence=0;
    ws.on('message',raw=>{const msg=JSON.parse(String(raw));if(msg.type==='terminal_history'||msg.type==='terminal_output'){output+=msg.payload.data;lastSequence=msg.payload.sequence;if(acknowledge)ws.send(JSON.stringify({type:'terminal_ack',payload:{sequence:lastSequence}}));}});
    await waitUntil(()=>ws.readyState===WebSocket.OPEN);
    await waitUntil(()=>output.includes('PTY_PID='));
    return {ws,output:()=>output,pause:()=>{acknowledge=false;},resume:()=>{acknowledge=true;ws.send(JSON.stringify({type:'terminal_ack',payload:{sequence:lastSequence}}));}};
  }
  try {
    const first=await gateway(true);
    client=new SessionServerClient({ipcPath:createPlatformAdapter().getIpcPath(root),tokenPath:resolveSessionServerTokenPath(root)});
    await client.connect();const identity=client.getServerIdentity();
    const a=await attach(first.ready);
    const ptyPid=/PTY_PID=(\d+)/.exec(a.output())?.[1];assert.ok(ptyPid);
    a.ws.close();await waitUntil(()=>a.ws.readyState===WebSocket.CLOSED);
    // An abrupt Gateway crash must leave the independently owned PTY alive.
    first.child.kill('SIGKILL');
    await waitUntil(()=>first.child.signalCode!==null);
    const second=await gateway();
    assert.equal(second.ready.status,'running');
    const b=await attach(second.ready);assert.ok(b.output().includes(`PTY_PID=${ptyPid}`));
    b.ws.send(JSON.stringify({type:'terminal_input',payload:{data:'restart-preserved\r'}}));
    await waitUntil(()=>b.output().includes('ECHO:restart-preserved'));
    assert.deepEqual(client.getServerIdentity(),identity);
    b.pause();const before=b.output().length;
    b.ws.send(JSON.stringify({type:'terminal_input',payload:{data:'flood\r'}}));
    await waitUntil(()=>b.output().length-before>=1024);
    await delay(200);const bounded=b.output().length;
    await delay(200);assert.equal(b.output().length,bounded,'no ACK must stop downstream delivery');
    assert.ok(bounded-before<512*1024,'render backlog remains bounded');
    b.resume();await waitUntil(()=>b.output().includes('FLOOD_END'));
    b.ws.close();await waitUntil(()=>b.ws.readyState===WebSocket.CLOSED);
    await stop(second.child);
    await client.shutdownServer();await client.disconnect();await delay(150);
    const third=await gateway();assert.equal(third.ready.status,'lost');await stop(third.child);
  } finally {
    for(const ws of sockets)ws.terminate();
    for(const child of children)await stop(child);
    await client?.disconnect().catch(()=>{});
    const cleanup=new SessionServerClient({ipcPath:createPlatformAdapter().getIpcPath(root),tokenPath:resolveSessionServerTokenPath(root)});
    try { await cleanup.connect();await cleanup.shutdownServer(); } finally { await cleanup.disconnect(); }
    await rm(root,{recursive:true,force:true});
  }
});
