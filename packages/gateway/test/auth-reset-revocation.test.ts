import assert from 'node:assert/strict';
import {test} from 'node:test';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import express from 'express';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {fileURLToPath} from 'node:url';
import {WebSocket} from 'ws';
import {createAdminUserRoutes} from '../src/routes/admin-users.js';
import {createAuthRouter} from '../src/routes/auth.js';
import {UserRepository} from '../src/db/repositories/user-repository.js';
import {signJwt} from '../src/auth/jwt.js';
import {resolveTokenUserId} from '../src/auth/resolve-token.js';
import {createAuthSession} from '../src/auth/session-service.js';
import {RuntimeAuthorizationInvalidator} from '../src/services/runtime-authorization-invalidation.js';
import {ForgeBadgerEventBus} from '../src/services/event-bus.js';
import {attachEventsWebSocket} from '../src/websocket/events.js';

test('administrator password reset rejects old JWT and opaque sessions on HTTP/WS and closes authenticated sockets',async()=>{
 const db=new Database(':memory:');migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 const users=new UserRepository(db),admin=users.create('admin@reset.test','hash',{role:'admin'}),member=users.create('member@reset.test','hash');
 const secret=randomBytes(32).toString('hex'),adminJwt=signJwt({userId:admin.id,email:admin.email},secret),oldJwt=signJwt({userId:member.id,email:member.email},secret),opaque=createAuthSession(db,{userId:member.id}).token;
 const invalidator=new RuntimeAuthorizationInvalidator(),seen:string[]=[];invalidator.subscribe(e=>seen.push(e.scope));
 const app=express();app.locals.db=db;app.locals.jwtSecret=secret;app.use(express.json());app.use('/admin',createAdminUserRoutes(db,invalidator));app.use('/auth',createAuthRouter(users,secret,{db}));
 const server=app.listen(0,'127.0.0.1');attachEventsWebSocket({server,eventBus:new ForgeBadgerEventBus(),db,jwtSecret:secret,runtimeAuthorizationInvalidator:invalidator});await once(server,'listening');
 const address=server.address();assert.ok(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
 const ws=new WebSocket(origin.replace('http:','ws:')+'/ws/events',['forgebadger-events',oldJwt]);await once(ws,'open');let closed=false;ws.once('close',()=>{closed=true;});
 try{
  assert.equal(resolveTokenUserId(db,oldJwt,secret),member.id);
  const response=await fetch(origin+`/admin/${member.id}/reset-password`,{method:'POST',headers:{Authorization:`Bearer ${adminJwt}`,'Content-Type':'application/json'},body:JSON.stringify({password:'new-password-for-test'})});assert.equal(response.status,200);
  assert.equal(resolveTokenUserId(db,oldJwt,secret),undefined);assert.equal(resolveTokenUserId(db,opaque,secret),undefined);
  assert.equal((await fetch(origin+'/auth/me',{headers:{Authorization:`Bearer ${oldJwt}`}})).status,401);
  for(let i=0;i<50&&!closed;i++)await new Promise(r=>setTimeout(r,10));assert.equal(closed,true);assert.ok(seen.includes('user'));
  assert.equal(resolveTokenUserId(db,adminJwt,secret),admin.id,'other users retain their credentials');
 }finally{ws.terminate();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));db.close();}
});

import {mkdtempSync,rmSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {SessionServer} from '../src/services/session-server/session-server.js';
import {IpcServer} from '../src/services/session-server/ipc-server.js';
import {SessionServerClient} from '../src/services/session-server-client.js';
import {InMemorySessionManager} from '../src/services/session-manager.js';
import {ProjectRepository} from '../src/db/repositories/project-repository.js';
import {SessionRepository} from '../src/db/repositories/session-repository.js';
import {attachTerminalWebSocket} from '../src/websocket/terminal.js';

test('reset closes a real authenticated terminal socket without killing its CLI process',{skip:process.platform==='win32',timeout:15000},async(t)=>{
 const root=realpathSync(mkdtempSync('/private/tmp/fb-reset-pty-')),ipcPath=path.join(root,'server.sock'),ipcToken=randomBytes(32).toString('hex'),daemon=new SessionServer(),ipc=new IpcServer({ipcPath,sessionServer:daemon,token:ipcToken});await ipc.start();
 const client=new SessionServerClient({ipcPath,token:ipcToken});await client.connect();const manager=new InMemorySessionManager(client),db=new Database(':memory:');let terminalSocket:WebSocket|undefined;let terminalServer:import('node:http').Server|undefined;
 t.after(async()=>{terminalSocket?.terminate();terminalServer?.closeAllConnections();if(terminalServer)await new Promise<void>(r=>terminalServer!.close(()=>r()));await client.disconnect();await daemon.destroy();await ipc.stop();db.close();rmSync(root,{recursive:true,force:true});});
 migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 const users=new UserRepository(db),admin=users.create('admin@terminalreset.test','hash',{role:'admin'}),user=users.create('user@terminalreset.test','hash'),project=new ProjectRepository(db,user.id).create({name:'Private terminal',path:root,aiTool:'codex'}),session=new SessionRepository(db,user.id).create({projectId:project.id,name:'Running',aiTool:'codex',workingDir:root,credentialMode:'host_environment',attachToken:randomBytes(24).toString('hex')}),invalidator=new RuntimeAuthorizationInvalidator(),secret=randomBytes(32).toString('hex');
 const live=await manager.createSession({userId:user.id,sessionId:session.id,attachToken:session.attachToken,launchPlan:{command:process.execPath,args:['-e','setInterval(()=>{},1000)'],cwd:root,env:{},secretEnvNames:[],credentialMode:'host_environment'}});new SessionRepository(db,user.id).update(session.id,{status:'running',runtimeSessionName:live.runtimeSessionName});
 const app=express();app.locals.db=db;app.locals.jwtSecret=secret;app.use(express.json());app.use('/admin',createAdminUserRoutes(db,invalidator));const server=app.listen(0,'127.0.0.1');terminalServer=server;attachTerminalWebSocket({server,sessionManager:manager,jwtSecret:secret,db,sessionServerIpcPath:ipcPath,sessionServerToken:ipcToken,runtimeAuthorizationInvalidator:invalidator});await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
 const ws=new WebSocket(origin.replace('http:','ws:')+`/ws/terminal/${session.id}`,['forgebadger-terminal',signJwt({userId:user.id,email:user.email},secret),session.attachToken]);terminalSocket=ws;
 await once(ws,'open');for(let i=0;i<100&&daemon.getSession(live.runtimeSessionName)?.clientCount!==1;i++)await new Promise(r=>setTimeout(r,10));assert.equal(daemon.getSession(live.runtimeSessionName)?.clientCount,1);
 const closed=once(ws,'close');const reset=await fetch(origin+`/admin/${user.id}/reset-password`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${signJwt({userId:admin.id,email:admin.email},secret)}`},body:JSON.stringify({password:'new-fixture-password'})});assert.equal(reset.status,200);assert.equal((await closed)[0],4403);assert.equal(await manager.hasLiveTerminal(session.id,live.runtimeSessionName),true);
});
