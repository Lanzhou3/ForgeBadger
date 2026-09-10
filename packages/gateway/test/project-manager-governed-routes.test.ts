import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { once } from 'node:events';
import { signJwt } from '../src/auth/jwt.js';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { createProjectManagerRoutes } from '../src/routes/project-manager.js';

test('PM HTTP mutations persist platform receipts and prepare only an idle session', async () => {
 const db=new Database(':memory:');
 migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 const user=new UserRepository(db).create('pm-governed@test.dev','hash');
 const project=new ProjectRepository(db,user.id).create({name:'p',path:'/tmp',aiTool:'claude'});
 const secret='test-jwt-secret-long-enough-for-tests';
 const app=express();app.locals.jwtSecret=secret;app.use(express.json());
 app.use('/projects',createProjectManagerRoutes(db,{adapterCommandRunner:async(command)=>({exitCode:0,stdout:`${command} 3.3.8`,stderr:''})}));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const base=`http://127.0.0.1:${address.port}/projects/${project.id}/project-manager/work-items`;
 const headers={'Content-Type':'application/json',Authorization:`Bearer ${signJwt({userId:user.id,email:user.email},secret)}`};
 try {
  const response=await fetch(base,{method:'POST',headers,body:JSON.stringify({title:'first'})});assert.equal(response.status,201);
  const created=await response.json();const itemId=created.data.workItem.id;
  const update=await fetch(`${base}/${itemId}`,{method:'PATCH',headers,body:JSON.stringify({title:'next'})});assert.equal(update.status,200);
  const prepared=await fetch(`${base}/${itemId}/task-packet/start`,{method:'POST',headers,body:'{}'});assert.equal(prepared.status,201);
  const payload=await prepared.json();assert.equal(payload.data.session.status,'idle');
  const again=await fetch(`${base}/${itemId}/task-packet/start`,{method:'POST',headers,body:'{}'});assert.equal(again.status,200);
  const intents=db.prepare('SELECT command_id FROM platform_action_intents WHERE user_id=? ORDER BY rowid').all(user.id) as {command_id:string}[];
  assert.deepEqual(intents.map(row=>row.command_id),['pm.work_item.create_with_evidence','pm.work_item.update','pm.task.prepare','pm.task.prepare']);
  assert.equal((db.prepare('SELECT count(*) n FROM platform_action_receipts WHERE user_id=?').get(user.id) as {n:number}).n,4);
 } finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));db.close();}
});
