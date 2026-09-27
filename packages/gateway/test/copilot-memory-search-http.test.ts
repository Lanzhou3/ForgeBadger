import assert from 'node:assert/strict';
import { it } from 'node:test';
import express from 'express';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { AgentMemoryRepository } from '../src/services/agent/memory.js';
import { createCopilotRoutes } from '../src/routes/copilot.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { signJwt } from '../src/auth/jwt.js';
it('returns retryable indexing status instead of partial success, and rejects oversized explicit queries',async()=>{
 const db=new Database(':memory:');migrate(drizzle(db),{migrationsFolder:new URL('../src/db/migrations',import.meta.url).pathname});
 const users=new UserRepository(db),owner=users.create('memory-http@example.invalid','hash'),other=users.create('memory-other@example.invalid','hash');
 const memory=new AgentMemoryRepository(db,owner.id);
 for(let i=0;i<65;i++)memory.create({scope:'global',kind:'fact',text:`用户私有记忆 item${i}`});
 db.prepare('DELETE FROM copilot_memory_search_index WHERE user_id=?').run(owner.id);
 const jwtSecret='b'.repeat(32),app=express();app.locals.db=db;app.locals.jwtSecret=jwtSecret;app.use(express.json());
 app.use('/api/v1/copilot',createCopilotRoutes({db,masterKey:'a'.repeat(64),eventBus:new ForgeBadgerEventBus()}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const search=(query:string,user=owner)=>fetch(`http://127.0.0.1:${address.port}/api/v1/copilot/memory/search?q=${encodeURIComponent(query)}`,{headers:{Authorization:`Bearer ${signJwt({userId:user.id,email:user.email},jwtSecret)}`}});
 try {
  const unrelated=await (await search('用户',other)).json() as {data:{entries:unknown[]}};
  assert.deepEqual(unrelated.data.entries,[]);
  assert.equal((db.prepare('SELECT count(*) n FROM copilot_memory_search_index').get() as {n:number}).n,0);
  const first=await search('item64');assert.equal(first.status,503);assert.equal(first.headers.get('retry-after'),'5');
  assert.equal((await first.json() as {details:{code:string}}).details.code,'AGENT_MEMORY_INDEX_BUILDING');
  const next=await search('item64');assert.equal(next.status,200);
  assert.equal((await next.json() as {data:{entries:unknown[]}}).data.entries.length,1);
  const long=await search(Array.from({length:25},(_,i)=>`word${i}`).join(' '));assert.equal(long.status,400);
  assert.equal((await long.json() as {details:{code:string}}).details.code,'AGENT_MEMORY_QUERY_TOO_LONG');
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));db.close();}
});
