import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomBytes } from 'node:crypto';
import express from 'express';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { signJwt } from '../src/auth/jwt.js';
import { createCopilotSkillRoutes } from '../src/routes/copilot-skills.js';
import { createCopilotPlaybookRoutes } from '../src/routes/copilot-playbooks.js';
import type { CopilotSkillDetail } from '../src/services/agent/skills/copilot-skill-service.js';

it('supports authenticated import/detail/update/toggle/history/rollback and legacy edits without cross-user or stale writes',async()=>{
 const db=new Database(':memory:');migrate(drizzle(db),{migrationsFolder:new URL('../src/db/migrations/',import.meta.url).pathname});
 const users=new UserRepository(db);const owner=users.create('new-api@test.dev','hash');const other=users.create('foreign-api@test.dev','hash');
 const secret=randomBytes(32).toString('hex');const token=signJwt({userId:owner.id,email:owner.email},secret);const foreignToken=signJwt({userId:other.id,email:other.email},secret);
 const app=express();app.locals.db=db;app.locals.jwtSecret=secret;app.use(express.json({limit:'8mb'}));
 app.use('/api/v1/copilot',createCopilotSkillRoutes(db,{availableToolNames:[]}));app.use('/api/v1/copilot',createCopilotPlaybookRoutes(db,{availableToolNames:[]}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}/api/v1/copilot`;
 const call=(route:string,method='GET',body?:unknown,credential=token)=>fetch(base+route,{method,headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const readSkill=async(response:Response)=>((await response.json()) as {data:{skill:CopilotSkillDetail}}).data.skill;
 const files=[{path:'SKILL.md',content:'---\nname: owner-guide\ndescription: Owner guidance\nversion: 1.0.0\n---\nRead references/check.md.'},{path:'references/check.md',content:'Keep full source.'}];
 try {
  assert.equal((await fetch(base+'/skills')).status,401);
  const initial=await call('/skills');assert.equal(initial.status,200);const initialBody=await initial.json() as {data:{skills:CopilotSkillDetail[]}};
  assert.equal(initialBody.data.skills.length,6);assert.ok(initialBody.data.skills.every(row=>!('files' in row)));
  assert.equal((await call('/skills/imports','POST',{source:{kind:'builtin'},files})).status,400);
  const response=await call('/skills/imports','POST',{source:{kind:'upload',label:'browser-folder'},files});assert.equal(response.status,201);const imported=await readSkill(response);
  assert.equal(imported.kind,'imported');assert.equal(imported.isEnabled,false);assert.deepEqual(imported.files,files);
  assert.equal((await call(`/skills/${imported.id}`,'GET',undefined,foreignToken)).status,404);
  assert.equal((await call(`/skills/${imported.id}/revisions`,'GET',undefined,foreignToken)).status,404);
  assert.equal((await call(`/skills/${imported.id}/enabled`,'PUT',{expectedRevisionId:imported.revisionId,enabled:true},foreignToken)).status,404);
  const enabled=await readSkill(await call(`/skills/${imported.id}/enabled`,'PUT',{expectedRevisionId:imported.revisionId,enabled:true}));assert.equal(enabled.available,true);
  const update=await call(`/skills/${imported.id}`,'PUT',{expectedRevisionId:imported.revisionId,files:[{...files[0]!,content:files[0]!.content.replace('1.0.0','2.0.0')},files[1]!]});assert.equal(update.status,200);const changed=await readSkill(update);
  assert.equal(changed.version,'2.0.0');assert.notEqual(changed.revisionId,imported.revisionId);assert.deepEqual(changed.source,imported.source);
  assert.equal((await call(`/skills/${imported.id}`,'PUT',{expectedRevisionId:imported.revisionId,files})).status,409);
  assert.equal((await call(`/skills/${imported.id}/rollback`,'POST',{expectedRevisionId:imported.revisionId,revisionId:imported.revisionId})).status,409);
  const history=await (await call(`/skills/${imported.id}/revisions`)).json() as {data:{revisions:{id:string}[]}};assert.equal(history.data.revisions.length,2);
  const old=await (await call(`/skills/${imported.id}/revisions/${imported.revisionId}`)).json() as {data:{revision:{files:typeof files}}};assert.deepEqual(old.data.revision.files,files);
  const rollback=await readSkill(await call(`/skills/${imported.id}/rollback`,'POST',{expectedRevisionId:changed.revisionId,revisionId:imported.revisionId}));assert.equal(rollback.version,'1.0.0');assert.notEqual(rollback.revisionId,imported.revisionId);
  const builtin=initialBody.data.skills.find(row=>row.name==='safety-and-approvals')!;
  const legacy=await call(`/playbooks/${builtin.id}`,'PUT',{content:'Legacy client custom body',version:builtin.currentVersion});assert.equal(legacy.status,200);
  const modern=await readSkill(await call(`/skills/${builtin.id}`));assert.equal(modern.content,'Legacy client custom body');assert.notEqual(modern.revisionId,builtin.revisionId);
  const builtHistory=await (await call(`/skills/${builtin.id}/revisions`)).json() as {data:{revisions:unknown[]}};assert.equal(builtHistory.data.revisions.length,2);
  db.prepare('UPDATE users SET status=? WHERE id=?').run('disabled',owner.id);
  assert.equal((await call('/skills/imports','POST',{source:{kind:'paste'},files})).status,401);
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));db.close();}
});
