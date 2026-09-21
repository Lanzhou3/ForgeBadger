import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,realpathSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SessionServer} from '../src/services/session-server/session-server.js';
import {IpcServer} from '../src/services/session-server/ipc-server.js';
import {SessionServerClient} from '../src/services/session-server-client.js';
import {groupIsAbsent} from '../src/services/session-server/confirmed-stop.js';
import {createPlatformAdapter,type PlatformPtyAdapter} from '../src/services/session-server/platform-adapter.js';

const native={skip:process.platform==='win32',timeout:20000};
async function until(fn:()=>boolean,ms=5000){const start=Date.now();while(!fn()){if(Date.now()-start>ms)throw new Error('fixture timeout');await new Promise(r=>setTimeout(r,20));}}
function fixture(platformAdapter?:PlatformPtyAdapter){
 const root=realpathSync(mkdtempSync(path.join(tmpdir(),'fb-confirm-stop-'))),server=new SessionServer(platformAdapter?{platformAdapter}:{}),nonce=randomUUID(),sessionId=randomUUID(),ready=path.join(root,'ready');
 const input=(code:string)=>({sessionId,launchNonce:nonce,userId:'fixture',attachToken:randomUUID(),launchPlan:{command:process.execPath,args:['-e',code],cwd:root,env:{},secretEnvNames:[],credentialMode:'host_environment' as const}});
 const ignore=`process.on('SIGHUP',()=>{});require('fs').writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000);`;
 return {root,server,nonce,sessionId,ready,input,ignore,async close(){for(const row of server.listSessions()){const handle=server.getSession(row.sessionId);if(handle&&!groupIsAbsent(handle.pty.pid)){try{process.kill(-handle.pty.pid,'SIGKILL');}catch{}}}await new Promise(r=>setTimeout(r,100));await server.destroy();rmSync(root,{recursive:true,force:true});}};
}
test('ignored SIGHUP is escalated and confirmed only after the real process group exits',native,async()=>{const f=fixture();try{
 const handle=await f.server.createSession(f.input(f.ignore));await until(()=>existsSync(f.ready));
 assert.equal(await f.server.confirmedStop(f.sessionId,f.nonce,false),false);
 assert.equal(await f.server.confirmedStop(f.sessionId,randomUUID(),true),false);
 assert.equal(await f.server.confirmedStop(f.sessionId,f.nonce,true),true);
 assert.equal(groupIsAbsent(handle.pty.pid),true);assert.equal(f.server.hasSession(f.sessionId),false);
 assert.equal(await f.server.confirmedStop(f.sessionId,f.nonce,true),true);
}finally{await f.close();}});

test('an old stop receipt cannot authorize stopping a respawn using the same launch nonce',native,async()=>{const f=fixture();try{
 await f.server.createSession(f.input(f.ignore));await until(()=>existsSync(f.ready));assert.equal(await f.server.confirmedStop(f.sessionId,f.nonce,true),true);
 await assert.rejects(()=>f.server.createSession(f.input(f.ignore)),/GENERATION|NONCE|REUSED/);
 assert.equal(f.server.hasSession(f.sessionId),false);
 const next=randomUUID();await f.server.createSession({...f.input(f.ignore),launchNonce:next});
 assert.equal(await f.server.confirmedStop(f.sessionId,f.nonce,false),true);assert.equal(f.server.hasSession(f.sessionId),true);
 assert.equal(await f.server.confirmedStop(f.sessionId,next,true),true);
}finally{await f.close();}});

test('a child surviving its leader keeps confirmed shutdown pending and prevents replacement',native,async()=>{const f=fixture();try{
 const childReady=path.join(f.root,'child');
 const child=`process.on('SIGHUP',()=>{});require('fs').writeFileSync(${JSON.stringify(childReady)},String(process.pid));setInterval(()=>{},1000);`;
 const parent=`require('child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
 const handle=await f.server.createSession(f.input(parent));await until(()=>existsSync(childReady));
 assert.equal(await f.server.confirmedStop(f.sessionId,f.nonce,true),false);
 assert.equal(f.server.hasSession(f.sessionId),true);assert.equal(groupIsAbsent(handle.pty.pid),false);
 await assert.rejects(()=>f.server.createSession({...f.input(f.ignore),launchNonce:randomUUID()}),/STOP_UNCONFIRMED|CREATE_NOT_STARTED/);
 const childPid=Number(readFileSync(childReady,'utf8'));process.kill(childPid,'SIGKILL');
 await until(()=>groupIsAbsent(handle.pty.pid));assert.equal(await f.server.confirmedStop(f.sessionId,f.nonce,false),true);
}finally{await f.close();}});

test('IPC reconnect recovers a lost stop reply while another daemon identity cannot assert its proof',native,async()=>{const f=fixture();
 const token=randomUUID()+randomUUID(),ipcPath=path.join(f.root,'s.sock'),ipc=new IpcServer({ipcPath,sessionServer:f.server,token});await ipc.start();
 const client=new SessionServerClient({ipcPath,token,requestTimeoutMs:50});
 try{
  await client.connect();const daemon=await client.confirmedStopAuthority();assert.ok(daemon);
  const generation={runtimeName:f.sessionId,launchNonce:f.nonce,daemon};
  await client.createSession({name:f.sessionId,cwd:f.root,command:process.execPath,args:['-e',f.ignore],env:{},launchNonce:f.nonce,expectedDaemon:daemon});await until(()=>existsSync(f.ready));
  // The request times out while the daemon continues its bounded stop. Reconnect
  // must query the same generation, not infer success from an empty registry.
  await assert.rejects(()=>client.confirmedStop(generation),/timeout|timed out/i);await client.disconnect();
  await until(()=>!f.server.hasSession(f.sessionId));await client.connect();
  assert.deepEqual(await client.confirmedStopStatus(generation),{...generation,stopped:true});
  assert.equal(await client.confirmedStopStatus({...generation,daemon:{...daemon,startedAt:'2000-01-01T00:00:00.000Z'}}),null);
  assert.equal(await client.confirmedStopStatus({...generation,launchNonce:randomUUID()}),null);
 }finally{await client.disconnect();await ipc.stop();await f.close();}
});

test('a proven command-resolution failure retains a generation-bound not-started receipt without treating an unknown nonce as stopped',native,async()=>{
 const adapter=createPlatformAdapter(),resolve=adapter.resolveCommand.bind(adapter);
 adapter.resolveCommand=(command,env)=>{if(command.endsWith('/nonexistent-cli'))throw new Error('Fixture command is unavailable');return resolve(command,env);};
 const f=fixture(adapter);try{
 const invalid=f.input(f.ignore);invalid.launchPlan.command=path.join(f.root,'nonexistent-cli');
 await assert.rejects(()=>f.server.createSession(invalid));
 assert.equal(f.server.hasSession(f.sessionId),false);
 assert.equal(await f.server.confirmedStop(f.sessionId,f.nonce,false),true);
 assert.equal(await f.server.confirmedStop(f.sessionId,randomUUID(),false),false);
 await f.server.createSession({...f.input(f.ignore),launchNonce:randomUUID()});
 assert.equal(f.server.hasSession(f.sessionId),true);
}finally{await f.close();}});

test('authenticated not-started proof is persisted by the manager and allows a later launch attempt',native,async()=>{
 const {default:Database}=await import('better-sqlite3'),{drizzle}=await import('drizzle-orm/better-sqlite3'),{migrate}=await import('drizzle-orm/better-sqlite3/migrator');
 const {fileURLToPath}=await import('node:url'),{UserRepository}=await import('../src/db/repositories/user-repository.js'),{ProjectRepository}=await import('../src/db/repositories/project-repository.js'),{SessionRepository}=await import('../src/db/repositories/session-repository.js');
 const {SessionRuntimeConfirmationRepository}=await import('../src/db/repositories/session-runtime-confirmation-repository.js'),{InMemorySessionManager}=await import('../src/services/session-manager.js');
 const adapter=createPlatformAdapter(),resolve=adapter.resolveCommand.bind(adapter);let fail=true;
 adapter.resolveCommand=(command,env)=>{if(fail)throw new Error('Temporary command resolution failure');return resolve(command,env);};
 const f=fixture(adapter),db=new Database(':memory:');db.pragma('foreign_keys=ON');migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 const user=new UserRepository(db).create('retry@confirmed.test','hash'),project=new ProjectRepository(db,user.id).create({name:'retry',path:f.root,aiTool:'codex'}),session=new SessionRepository(db,user.id).create({projectId:project.id,name:'retry',aiTool:'codex',workingDir:f.root});
 const ipcPath=path.join(f.root,'retry.sock'),token=randomUUID()+randomUUID(),ipc=new IpcServer({ipcPath,sessionServer:f.server,token});await ipc.start();
 const client=new SessionServerClient({ipcPath,token}),manager=new InMemorySessionManager(client,undefined,undefined,{db}),repo=new SessionRuntimeConfirmationRepository(db,user.id);
 const input={userId:user.id,sessionId:session.id,launchPlan:f.input(f.ignore).launchPlan};
 try{
  await assert.rejects(()=>manager.createSession(input),/NOT_STARTED/);assert.equal(repo.get(session.id)?.status,'stopped');const before=repo.get(session.id)?.launchNonce;
  fail=false;await manager.createSession(input);await until(()=>existsSync(f.ready));assert.equal(repo.get(session.id)?.status,'pending');assert.notEqual(repo.get(session.id)?.launchNonce,before);
  await manager.stopSession(session.id);assert.equal(repo.get(session.id)?.status,'stopped');
 }finally{await client.disconnect();await ipc.stop();await f.close();db.close();}
});
