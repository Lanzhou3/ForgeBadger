import assert from 'node:assert/strict';
import {it} from 'node:test';
import {randomBytes} from 'node:crypto';
import express from 'express';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {UserRepository} from '../src/db/repositories/user-repository.js';
import {SkillRepository} from '../src/db/repositories/skill-repository.js';
import {signJwt} from '../src/auth/jwt.js';
import {createCopilotPlaybookRoutes} from '../src/routes/copilot-playbooks.js';
import {createSkillRoutes} from '../src/routes/skills.js';
import {BUILTIN_COPILOT_SKILLS} from '../src/services/agent/skills/copilot-skills.js';
import type {CopilotPlaybook} from '../src/services/agent/skills/skill-queries.js';

it('serves independently scoped catalog/edit/toggle APIs with active-user validation and version review',async()=>{
 const db=new Database(':memory:');migrate(drizzle(db),{migrationsFolder:new URL('../src/db/migrations/',import.meta.url).pathname});
 const user=new UserRepository(db).create('api-owner@test.dev','hash');
 const other=new UserRepository(db).create('api-other@test.dev','hash');
 const secret=randomBytes(32).toString('hex');
 const app=express();app.locals.db=db;app.locals.jwtSecret=secret;app.use(express.json());
 app.use('/api/v1/copilot',createCopilotPlaybookRoutes(db,{availableToolNames:BUILTIN_COPILOT_SKILLS.flatMap(s=>[...s.requiredTools])}));
 app.use('/api/v1',createSkillRoutes(db));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}/api/v1`;
 const token=signJwt({userId:user.id,email:user.email},secret);const otherToken=signJwt({userId:other.id,email:other.email},secret);
 async function request(route:string, method='GET', body?:unknown, credential=token) {
  return fetch(base+route,{method,headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 }
 try {
  assert.equal((await fetch(base+'/copilot/playbooks')).status,401);
  const catalog=await request('/copilot/playbooks');assert.equal(catalog.status,200);
  const rows=((await catalog.json()) as {data:{playbooks:CopilotPlaybook[]}}).data.playbooks;
  assert.equal(rows.length,6);const row=rows.find(s=>s.name==='session-dispatch')!;
  const cli=new SkillRepository(db,user.id).create({name:row.name,content:'CLI data'});
  assert.equal((await request('/skills/'+row.id)).status,404);
  assert.equal((await request('/skills/'+row.id,'PUT',{content:'attack'})).status,404);
  assert.equal((await request('/skills/'+row.id+'/toggle','POST',{enabled:false})).status,404);
  assert.equal((await request('/skills/'+row.id,'DELETE')).status,404);
  assert.equal((await request('/copilot/playbooks/'+cli.id,'PUT',{content:'bad',version:row.version})).status,404);
  assert.equal((await request('/copilot/playbooks/'+row.id,'PUT',{content:'foreign',version:row.version},otherToken)).status,404);
  assert.equal((await request('/copilot/playbooks/'+row.id+'/enabled','PUT',{enabled:false},otherToken)).status,404);
  const toggle=await request('/copilot/playbooks/'+row.id+'/enabled','PUT',{enabled:false});assert.equal(toggle.status,200);
  const toggled=((await toggle.json()) as {data:{playbook:CopilotPlaybook}}).data.playbook;
  assert.equal(toggled.isEnabled,false);assert.equal(toggled.available,false);assert.equal(toggled.id,row.id);
  assert.equal(new SkillRepository(db,user.id).getById(cli.id)?.isEnabled,true);
  const repo=new SkillRepository(db,user.id,'copilot');repo.update(row.id,{content:'Retained old customized handbook',version:'1.0.0'});
  assert.equal((await request('/copilot/playbooks/'+row.id+'/enabled','PUT',{enabled:true})).status,409);
  assert.equal((await request('/copilot/playbooks/'+row.id,'PUT',{content:'Reviewed custom text',version:'1.0.0'})).status,409);
  assert.equal((await request('/copilot/playbooks/'+row.id,'PUT',{content:'Reviewed custom text',version:row.currentVersion,source:'builtin'})).status,400);
  const update=await request('/copilot/playbooks/'+row.id,'PUT',{content:'Reviewed custom text',version:row.currentVersion});assert.equal(update.status,200);
  const updated=((await update.json()) as {data:{playbook:CopilotPlaybook}}).data.playbook;
  assert.equal(updated.content,'Reviewed custom text');assert.equal(updated.reviewRequired,false);assert.equal(updated.isEnabled,false);
  assert.equal((await request('/copilot/playbooks/'+row.id+'/enabled','PUT',{enabled:true})).status,200);
  assert.equal(new SkillRepository(db,user.id).getById(cli.id)?.content,'CLI data');
  db.prepare('UPDATE users SET status=? WHERE id=?').run('disabled',user.id);
  assert.equal((await request('/copilot/playbooks')).status,401);
 } finally {
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));db.close();
 }
});
