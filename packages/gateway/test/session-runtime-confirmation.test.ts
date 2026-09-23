import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {UserRepository} from '../src/db/repositories/user-repository.js';
import {ProjectRepository} from '../src/db/repositories/project-repository.js';
import {SessionRepository} from '../src/db/repositories/session-repository.js';
import {SessionRuntimeConfirmationRepository} from '../src/db/repositories/session-runtime-confirmation-repository.js';
function fixture(){
 const root=realpathSync(mkdtempSync(path.join(tmpdir(),'fb-stop-receipt-'))),file=path.join(root,'db.sqlite'),db=new Database(file);db.pragma('foreign_keys=ON');migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 const users=new UserRepository(db),user=users.create('one@stop.test','hash'),other=users.create('two@stop.test','hash'),project=new ProjectRepository(db,user.id).create({name:'test',path:root,aiTool:'codex'}),session=new SessionRepository(db,user.id).create({projectId:project.id,name:'test',aiTool:'codex',workingDir:root}),repo=new SessionRuntimeConfirmationRepository(db,user.id);
 const generation={runtimeName:'fb-fixture-'+session.id,launchNonce:randomUUID(),daemon:{pid:12345,startedAt:new Date().toISOString()}},receipt={...generation,stopped:true as const};
 return {db,file,user,other,session,repo,generation,receipt,close(){db.close();rmSync(root,{recursive:true,force:true});}};
}
test('stop confirmation is scoped, generation-bound and survives database reopen',()=>{const f=fixture();try{
 assert.equal(f.repo.get(f.session.id),undefined);f.repo.begin(f.session.id,f.generation);assert.equal(f.repo.get(f.session.id)?.status,'pending');
 assert.equal(new SessionRuntimeConfirmationRepository(f.db,f.other.id).get(f.session.id),undefined);
 assert.throws(()=>new SessionRuntimeConfirmationRepository(f.db,f.other.id).begin(f.session.id,{...f.generation,launchNonce:randomUUID()}));
 assert.equal(f.repo.confirm(f.session.id,f.generation.launchNonce,{...f.receipt,daemon:{...f.receipt.daemon,pid:999}}),false);
 assert.equal(f.repo.confirm(f.session.id,randomUUID(),f.receipt),false);
 assert.equal(f.repo.confirm(f.session.id,f.generation.launchNonce,f.receipt),true);
 const reopened=new Database(f.file);try{const stored=new SessionRuntimeConfirmationRepository(reopened,f.user.id).get(f.session.id);assert.equal(stored?.status,'stopped');assert.deepEqual(stored?.receipt,f.receipt);}finally{reopened.close();}
 assert.equal(f.repo.confirm(f.session.id,f.generation.launchNonce,f.receipt),true);
}finally{f.close();}});
test('unknown generations cannot be overwritten and old stop proof cannot confirm a later launch',()=>{const f=fixture();try{
 f.repo.begin(f.session.id,f.generation);f.repo.begin(f.session.id,f.generation);const next={...f.generation,launchNonce:randomUUID()};
 assert.throws(()=>f.repo.begin(f.session.id,next),/STOP_UNCONFIRMED/);assert.equal(f.repo.get(f.session.id)?.launchNonce,f.generation.launchNonce);
 assert.equal(f.repo.confirm(f.session.id,f.generation.launchNonce,f.receipt),true);assert.throws(()=>f.repo.begin(f.session.id,f.generation),/GENERATION_REUSED/);
 f.repo.begin(f.session.id,next);assert.equal(f.repo.get(f.session.id)?.receipt,null);assert.equal(f.repo.confirm(f.session.id,f.generation.launchNonce,f.receipt),false);assert.equal(f.repo.get(f.session.id)?.status,'pending');
 assert.throws(()=>f.repo.confirm(f.session.id,next.launchNonce,{...next,stopped:false} as never));
}finally{f.close();}});
test('revoke transitions only pending rows and releases the deletion guard',()=>{const f=fixture();try{
 const sessions=new SessionRepository(f.db,f.user.id);
 assert.equal(f.repo.revoke(f.session.id),false,'no row is a no-op');
 f.repo.begin(f.session.id,f.generation);
 assert.throws(()=>sessions.delete(f.session.id),/SESSION_RUNTIME_STOP_UNCONFIRMED/);
 assert.equal(f.repo.revoke(f.session.id),true);
 assert.equal(f.repo.get(f.session.id)?.status,'revoked');
 // A relaunch after revocation starts a fresh pending generation.
 const relaunch={...f.generation,launchNonce:randomUUID()};
 f.repo.begin(f.session.id,relaunch);assert.equal(f.repo.get(f.session.id)?.status,'pending');
 assert.equal(f.repo.revoke(f.session.id),true);
 sessions.delete(f.session.id);assert.equal(sessions.getById(f.session.id),undefined);
 assert.equal(f.repo.get(f.session.id),undefined,'revoked row cascades with the session row');
 // Stopped rows are kept: the receipt is the audit trail, and revoke is a no-op.
 const second=sessions.create({projectId:f.session.projectId,name:'second',aiTool:'codex',workingDir:f.session.workingDir});
 const next={...f.generation,runtimeName:'fb-fixture-'+second.id,launchNonce:randomUUID()};
 f.repo.begin(second.id,next);assert.equal(f.repo.confirm(second.id,next.launchNonce,{...next,stopped:true}),true);
 assert.equal(f.repo.revoke(second.id),false);assert.equal(f.repo.get(second.id)?.status,'stopped');
 sessions.delete(second.id);assert.equal(f.repo.get(second.id),undefined,'confirmed stop still cascades with the session row');
}finally{f.close();}});
