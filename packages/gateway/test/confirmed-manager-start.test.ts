import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,realpathSync,mkdirSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {UserRepository} from '../src/db/repositories/user-repository.js';
import {ProjectRepository} from '../src/db/repositories/project-repository.js';
import {SessionRepository} from '../src/db/repositories/session-repository.js';
import {SessionRuntimeConfirmationRepository} from '../src/db/repositories/session-runtime-confirmation-repository.js';
import {InMemorySessionManager} from '../src/services/session-manager.js';
import {ConfirmedSessionNotStartedError} from '../src/services/session-server/confirmed-stop.js';
import type {TerminalBackendClient} from '../src/services/terminal-backend.js';

test('preflight denial creates no pending generation; proven not-started creation can retry with a fresh generation',async()=>{
 const root=realpathSync(mkdtempSync(path.join(tmpdir(),'fb-manager-admission-'))),db=new Database(':memory:');migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 try{
 const users=new UserRepository(db),user=users.create('allowed@launch.test','hash'),other=users.create('other@launch.test','hash');const own=path.join(root,'own'),foreign=path.join(root,'foreign');mkdirSync(own);mkdirSync(foreign);
 const p=new ProjectRepository(db,user.id).create({name:'own',path:own,aiTool:'codex'}),q=new ProjectRepository(db,other.id).create({name:'foreign',path:foreign,aiTool:'codex'});db.prepare('INSERT INTO collaboration_projects(user_id,project_id,protected_root) VALUES(?,?,?)').run(other.id,q.id,foreign);
 const session=new SessionRepository(db,user.id).create({projectId:p.id,name:'admission',workingDir:own,aiTool:'codex'}),daemon={pid:12345,startedAt:new Date().toISOString()};let calls=0;const nonces:string[]=[];
 const backend:TerminalBackendClient={supportsConfirmedSessionStop:()=>true,confirmedStopAuthority:async()=>daemon,async createSession(options){calls++;nonces.push(options.launchNonce!);throw new ConfirmedSessionNotStartedError({runtimeName:options.name,launchNonce:options.launchNonce!,daemon:options.expectedDaemon!,stopped:true});},async killSession(){},async capturePane(){return '';},async listSessions(){return [];},async hasSession(){return false;}};
 const manager=new InMemorySessionManager(backend,undefined,undefined,{db}),confirmations=new SessionRuntimeConfirmationRepository(db,user.id);
 const launchPlan={command:'absent-cli',args:[],env:{},secretEnvNames:[],credentialMode:'host_environment' as const,cwd:foreign};
 await assert.rejects(()=>manager.createSession({userId:user.id,sessionId:session.id,launchPlan}),/MANAGED_PROJECT_ACCESS_DENIED/);assert.equal(calls,0);assert.equal(confirmations.get(session.id),undefined);
 for(let i=0;i<2;i++){await assert.rejects(()=>manager.createSession({userId:user.id,sessionId:session.id,launchPlan:{...launchPlan,cwd:own}}),/SESSION_CREATE_NOT_STARTED/);assert.equal(confirmations.get(session.id)?.status,'stopped');}
 assert.equal(calls,2);assert.notEqual(nonces[0],nonces[1]);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
