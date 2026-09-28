import assert from 'node:assert/strict';
import {test} from 'node:test';
import {InMemorySessionManager} from '../src/services/session-manager.js';
import type {TerminalBackendClient} from '../src/services/terminal-backend.js';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {SessionServerClient} from '../src/services/session-server-client.js';

test('legacy backend does not claim confirmed-stop capability',()=>{
 const manager=new InMemorySessionManager({} as TerminalBackendClient);
 assert.equal(manager.supportsConfirmedSessionStop(),false);
});

test('protocol-v2 legacy hello keeps ordinary reads and launch, blocks managed launch and refreshes capability on reconnect',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'fb-legacy-capability-')),ipcPath=path.join(root,'s.sock'),token=randomUUID();
 let capable=false,creates=0;
 const server=createServer(socket=>{let buffer='';socket.setEncoding('utf8');socket.on('data',chunk=>{buffer+=chunk;let newline:number;while((newline=buffer.indexOf('\n'))>=0){const message=JSON.parse(buffer.slice(0,newline));buffer=buffer.slice(newline+1);let reply:unknown;
  if(message.type==='hello'){assert.equal(message.token,token);reply={type:'hello_ok',protocolVersion:2,pid:process.pid,startedAt:'2026-09-20T00:00:00.000Z',...(capable?{capabilities:{confirmed_stop_v1:true}}:{})};}
  else if(message.type==='list_sessions')reply={id:message.id,type:'ok',data:[{sessionId:'existing'}]};
  else if(message.type==='capture_pane')reply={id:message.id,type:'ok',data:{content:'existing terminal'}};
  else if(message.type==='create_session'){creates++;reply={id:message.id,type:'ok',data:{}};}
  else reply={id:message.id,type:'error',message:'unsupported legacy message'};
  socket.write(JSON.stringify(reply)+'\n');
 }});});server.listen(ipcPath);await once(server,'listening');const client=new SessionServerClient({ipcPath,token});
 try{
  await client.connect();assert.equal(client.supportsConfirmedSessionStop(),false);assert.equal(await client.confirmedStopAuthority(),null);
  assert.deepEqual(await client.listSessions(),['existing']);assert.equal(await client.capturePane('existing'),'existing terminal');
  const ordinary={name:'ordinary',cwd:root,command:process.execPath,args:[],env:{}};await client.createSession(ordinary);assert.equal(creates,1);
  await assert.rejects(()=>client.createSession({...ordinary,name:'managed',launchNonce:randomUUID(),expectedDaemon:client.getServerIdentity()}),/UPGRADE_REQUIRED/);assert.equal(creates,1);
  await client.disconnect();capable=true;await client.connect();assert.equal(client.supportsConfirmedSessionStop(),true);
  await client.disconnect();capable=false;await client.connect();assert.equal(client.supportsConfirmedSessionStop(),false);
 }finally{await client.disconnect();await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(root,{recursive:true,force:true});}
});
