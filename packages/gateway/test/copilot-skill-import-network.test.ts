import assert from 'node:assert/strict';
import { it } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { SkillRepository } from '../src/db/repositories/skill-repository.js';
import { importCopilotSkill } from '../src/services/agent/skills/copilot-skill-import.js';
import type { publicFetch } from '../src/services/extensions/public-fetch.js';
const text='---\nname: public-guide\ndescription: Public text\n---\nReview safely.';
function fixture(){const db=new Database(':memory:');migrate(drizzle(db),{migrationsFolder:new URL('../src/db/migrations/',import.meta.url).pathname});const user=new UserRepository(db).create('url-skills@test.dev','hash');return{db,user};}
it('imports a public raw URL as one bounded immutable SKILL.md resource and retains its source',async()=>{
 const f=fixture();try{
  const fetcher:typeof publicFetch=async(input,init,beforeSend)=>{assert.equal(String(input),'https://example.com/SKILL.md');assert.equal(init?.method,'GET');beforeSend?.();return new Response(text);};
  const skill=await importCopilotSkill(f.db,f.user.id,{source:{kind:'url',url:'https://example.com/SKILL.md'}},{},fetcher);
  assert.deepEqual(skill.files,[{path:'SKILL.md',content:text}]);assert.equal(skill.source.url,'https://example.com/SKILL.md');assert.equal(skill.isEnabled,false);
 }finally{f.db.close();}
});
it('rejects private and plaintext URLs through the actual public network guard without importing',async()=>{
 const f=fixture();try{
  for(const url of ['http://example.com/SKILL.md','https://127.0.0.1/SKILL.md','https://localhost/SKILL.md']) {
   await assert.rejects(importCopilotSkill(f.db,f.user.id,{source:{kind:'url',url}}),/HTTPS|public|Loopback|loopback|Private/i);
  }
  assert.equal(new SkillRepository(f.db,f.user.id,'copilot').listOwnedBySource('copilot-import').length,0);
 }finally{f.db.close();}
});
it('rechecks owner authorization before socket creation and after a response, retaining no package on revocation',async()=>{
 for(const point of ['before','after'] as const){const f=fixture();try{
  const fetcher:typeof publicFetch=async(_input,_init,beforeSend)=>{
   if(point==='before')f.db.prepare('UPDATE users SET status=? WHERE id=?').run('disabled',f.user.id);
   beforeSend?.();
   if(point==='after')f.db.prepare('UPDATE users SET status=? WHERE id=?').run('disabled',f.user.id);
   return new Response(text);
  };
  await assert.rejects(importCopilotSkill(f.db,f.user.id,{source:{kind:'url',url:'https://example.com/SKILL.md'}},{},fetcher),/inactive/);
  assert.equal(new SkillRepository(f.db,f.user.id,'copilot').listOwnedBySource('copilot-import').length,0);
 }finally{f.db.close();}}
});
it('rejects invalid UTF-8, unsuccessful responses and oversized bodies before storing source content',async()=>{
 const f=fixture();try{
  for(const response of [new Response(Uint8Array.from([0xff,0xfe])),new Response('missing',{status:404}),new Response('x'.repeat(128*1024+1))]) {
   await assert.rejects(importCopilotSkill(f.db,f.user.id,{source:{kind:'url',url:'https://example.com/SKILL.md'}},{},async()=>response));
  }
  assert.equal(new SkillRepository(f.db,f.user.id,'copilot').listOwnedBySource('copilot-import').length,0);
 }finally{f.db.close();}
});
