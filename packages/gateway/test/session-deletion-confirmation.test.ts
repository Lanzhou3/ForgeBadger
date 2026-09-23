import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {UserRepository} from '../src/db/repositories/user-repository.js';
import {ProjectRepository} from '../src/db/repositories/project-repository.js';
import {SessionRepository} from '../src/db/repositories/session-repository.js';
import {SessionRuntimeConfirmationRepository} from '../src/db/repositories/session-runtime-confirmation-repository.js';
import {InMemorySessionManager} from '../src/services/session-manager.js';
import {RuntimeAuthorizationInvalidator} from '../src/services/runtime-authorization-invalidation.js';
import {createSessionRoutes} from '../src/routes/sessions.js';
import {createProjectRoutes} from '../src/routes/projects.js';
import {signJwt} from '../src/auth/jwt.js';
function fixture(){
 const root=realpathSync(mkdtempSync(path.join(tmpdir(),'fb-delete-confirm-'))),db=new Database(':memory:');db.pragma('foreign_keys=ON');migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 const user=new UserRepository(db).create('delete@fixture.test','hash'),projects=new ProjectRepository(db,user.id),project=projects.create({name:'test',path:root,aiTool:'codex'}),sessions=new SessionRepository(db,user.id),session=sessions.create({projectId:project.id,name:'test',aiTool:'codex',workingDir:root}),repo=new SessionRuntimeConfirmationRepository(db,user.id);
 const generation={runtimeName:'fb-fixture-'+session.id,launchNonce:randomUUID(),daemon:{pid:12345,startedAt:new Date().toISOString()}},receipt={...generation,stopped:true as const};repo.begin(session.id,generation);sessions.update(session.id,{status:'error',runtimeSessionName:generation.runtimeName});
 return {db,user,project,session,projects,sessions,repo,generation,receipt,close(){db.close();rmSync(root,{recursive:true,force:true});}};
}
for(const scope of ['session','project','user','proof'] as const)test(`pending stop proof survives direct ${scope} deletion and confirmed proof permits deletion`,()=>{const f=fixture();try{
 const remove=()=>{if(scope==='session')f.sessions.delete(f.session.id);else if(scope==='project')f.projects.delete(f.project.id);else if(scope==='user')f.db.prepare('DELETE FROM users WHERE id=?').run(f.user.id);else f.db.prepare('DELETE FROM session_runtime_confirmations WHERE session_id=?').run(f.session.id);};
 assert.throws(remove,/SESSION_RUNTIME_STOP_UNCONFIRMED/);assert.equal(f.repo.get(f.session.id)?.status,'pending');assert.ok(f.sessions.getById(f.session.id));assert.ok(f.projects.getById(f.project.id));
 f.repo.confirm(f.session.id,f.generation.launchNonce,f.receipt);remove();assert.equal(f.repo.get(f.session.id),undefined);assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
}finally{f.close();}});
for(const scope of ['session','project'] as const)test(`HTTP ${scope} deletion keeps an error-status session on uncertain stop and succeeds after receipt`,async()=>{const f=fixture();let confirmed=false;const invalidations:unknown[]=[];try{
 const manager=new InMemorySessionManager({supportsConfirmedSessionStop:()=>true,confirmedStop:async()=>confirmed?f.receipt:null,confirmedStopStatus:async()=>confirmed?f.receipt:null,createSession:async()=>{},killSession:async()=>{throw new Error('unavailable');},capturePane:async()=>'',listSessions:async()=>[],hasSession:async()=>false},undefined,undefined,{db:f.db});
 const invalidator=new RuntimeAuthorizationInvalidator();invalidator.subscribe(value=>invalidations.push(value));const secret=randomBytes(32).toString('hex'),app=express();app.locals.db=f.db;app.locals.jwtSecret=secret;app.use(express.json());app.use('/sessions',createSessionRoutes(f.db,randomBytes(32).toString('hex'),manager,invalidator));app.use('/projects',createProjectRoutes(f.db,invalidator,manager));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');try{const address=server.address();assert.ok(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}/${scope==='session'?'sessions/'+f.session.id:'projects/'+f.project.id}`,headers={Authorization:`Bearer ${signJwt({userId:f.user.id,email:f.user.email},secret)}`};
 const rejected=await fetch(url,{method:'DELETE',headers});assert.equal(rejected.status,409);assert.equal((await rejected.json() as {details:{code:string}}).details.code,'SESSION_RUNTIME_STOP_UNCONFIRMED');assert.ok(f.sessions.getById(f.session.id));assert.equal(f.repo.get(f.session.id)?.status,'pending');assert.equal(invalidations.length,0);
 confirmed=true;const accepted=await fetch(url,{method:'DELETE',headers});assert.equal(accepted.status,200);assert.equal(f.sessions.getById(f.session.id),undefined);assert.equal(f.repo.get(f.session.id),undefined);assert.equal(invalidations.length,1);
 if(scope==='session'){const activity=f.db.prepare("SELECT type FROM session_activities WHERE project_id=? AND type='session_deleted'").get(f.project.id) as {type:string}|undefined;assert.equal(activity?.type,'session_deleted');}
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}finally{f.close();}});

function forceFixture(status:'running'|'exited'|'error'|null){const f=fixture();
 const infos=status===null?[]:[{sessionId:'fb-fixture-'+f.session.id,userId:f.user.id,status}];
 const manager=new InMemorySessionManager({supportsConfirmedSessionStop:()=>true,confirmedStop:async()=>null,confirmedStopStatus:async()=>null,createSession:async()=>{},killSession:async()=>{throw new Error('SESSION_STOP_UNCONFIRMED');},capturePane:async()=>'',listSessions:async()=>infos.map(i=>i.sessionId),listSessionInfos:async()=>infos,hasSession:async()=>infos.length>0},undefined,undefined,{db:f.db});
 const invalidator=new RuntimeAuthorizationInvalidator();const secret=randomBytes(32).toString('hex'),app=express();app.locals.db=f.db;app.locals.jwtSecret=secret;app.use(express.json());app.use('/sessions',createSessionRoutes(f.db,randomBytes(32).toString('hex'),manager,invalidator));
 return {...f,manager,app,secret,headers:{Authorization:`Bearer ${signJwt({userId:f.user.id,email:f.user.email},secret)}`}};
}
test('HTTP force delete is rejected while the runtime leader is still running',async()=>{const f=forceFixture('running');try{
 const server=f.app.listen(0,'127.0.0.1');await once(server,'listening');try{const address=server.address();assert.ok(address&&typeof address!=='string');
 const rejected=await fetch(`http://127.0.0.1:${address.port}/sessions/${f.session.id}?force=true`,{method:'DELETE',headers:f.headers});
 assert.equal(rejected.status,409);assert.equal((await rejected.json() as {details:{code:string}}).details.code,'SESSION_FORCE_DELETE_NOT_ALLOWED');
 assert.ok(f.sessions.getById(f.session.id));assert.equal(f.repo.get(f.session.id)?.status,'pending');
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}finally{f.close();}});
for(const info of [{status:'exited' as const},{status:'error' as const},null])test(`HTTP force delete succeeds when the leader ${info?`reported ${info.status}`:'is absent from the daemon'}`,async()=>{const f=forceFixture(info?info.status:null);try{
 const server=f.app.listen(0,'127.0.0.1');await once(server,'listening');try{const address=server.address();assert.ok(address&&typeof address!=='string');
 const accepted=await fetch(`http://127.0.0.1:${address.port}/sessions/${f.session.id}?force=true`,{method:'DELETE',headers:f.headers});
 assert.equal(accepted.status,200);
 assert.equal(f.sessions.getById(f.session.id),undefined);assert.equal(f.repo.get(f.session.id),undefined);
 const activity=f.db.prepare("SELECT type,metadata FROM session_activities WHERE project_id=? AND type='session_force_deleted'").get(f.project.id) as {type:string;metadata:string|null}|undefined;
 assert.equal(activity?.type,'session_force_deleted');assert.equal(activity?.metadata,JSON.stringify({force:true}));
 assert.equal(f.db.pragma('foreign_key_check').length,0);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}finally{f.close();}});

test('HTTP force delete fails closed when the runtime state cannot be verified',async()=>{
 for(const variant of ['unsupported','unreachable'] as const){const f=fixture();try{
  const probe=variant==='unsupported'?{}:{listSessionInfos:async()=>{throw new Error('ipc down');}};
  const manager=new InMemorySessionManager({supportsConfirmedSessionStop:()=>true,confirmedStop:async()=>null,confirmedStopStatus:async()=>null,createSession:async()=>{},killSession:async()=>{},capturePane:async()=>'',listSessions:async()=>[],hasSession:async()=>false,...probe},undefined,undefined,{db:f.db});
  const invalidator=new RuntimeAuthorizationInvalidator();const secret=randomBytes(32).toString('hex'),app=express();app.locals.db=f.db;app.locals.jwtSecret=secret;app.use(express.json());app.use('/sessions',createSessionRoutes(f.db,randomBytes(32).toString('hex'),manager,invalidator));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');try{const address=server.address();assert.ok(address&&typeof address!=='string');
  const headers={Authorization:`Bearer ${signJwt({userId:f.user.id,email:f.user.email},secret)}`};
  const rejected=await fetch(`http://127.0.0.1:${address.port}/sessions/${f.session.id}?force=true`,{method:'DELETE',headers});
  assert.equal(rejected.status,409,variant);assert.equal((await rejected.json() as {details:{code:string}}).details.code,'SESSION_FORCE_DELETE_NOT_ALLOWED',variant);
  assert.ok(f.sessions.getById(f.session.id),variant);assert.equal(f.repo.get(f.session.id)?.status,'pending',variant);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
 }finally{f.close();}}
});
