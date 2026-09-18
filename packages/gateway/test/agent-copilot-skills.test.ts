import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { SkillRepository } from '../src/db/repositories/skill-repository.js';
import { BUILTIN_COPILOT_SKILLS } from '../src/services/agent/skills/copilot-skills.js';
import { listCopilotPlaybooks, listEnabledCopilotPlaybookSummaries, loadCopilotPlaybook } from '../src/services/agent/skills/skill-queries.js';
import { createSkillTools } from '../src/services/agent/tools/skills.js';
import { stripFrontmatter } from '../src/services/skill-frontmatter.js';
import type { AgentToolContext } from '../src/services/agent/tool-registry.js';
const availableToolNames = [...new Set(BUILTIN_COPILOT_SKILLS.flatMap(s=>[...s.requiredTools]))];
const options = {availableToolNames};
function fixture() {
 const db = new Database(':memory:');
 migrate(drizzle(db),{migrationsFolder:new URL('../src/db/migrations/',import.meta.url).pathname});
 const user = new UserRepository(db).create('skills@test.dev','hash');
 const repo = new SkillRepository(db,user.id,'copilot');
 const context:AgentToolContext = {db,userId:user.id,masterKey:'unused',availableToolNames};
 return {db,user,repo,context};
}
describe('Copilot playbook boundary',()=>{
 it('lists only dedicated playbooks and exposes stable IDs without bodies',async()=>{
  const {db,user,context}=fixture();try{
   new SkillRepository(db,user.id).create({name:'cli-only',content:'Never expose this CLI body'});
   const rows=listEnabledCopilotPlaybookSummaries(db,user.id,options);
   assert.equal(rows.length,6);assert.equal(new Set(rows.map(s=>s.id)).size,6);
   assert.ok(!JSON.stringify(rows).includes('Never expose'));
   assert.ok(rows.every(s=>!('content' in s)));
   const listed=await createSkillTools()[0]!.execute({},context);
   assert.deepEqual(listed,{count:rows.length,playbooks:rows});
  }finally{db.close();}
 });
 it('rechecks disabled state, missing dependencies and review version on direct ID load',async()=>{
  const {db,user,repo,context}=fixture();try{
   const row=listCopilotPlaybooks(db,user.id,options).find(s=>s.name==='session-dispatch')!;
   const load=createSkillTools()[1]!;
   assert.equal((await load.execute({id:row.id},context) as {found:boolean}).found,true);
   repo.toggle(row.id,false);
   assert.equal((await load.execute({id:row.id},context) as {found:boolean}).found,false);
   repo.toggle(row.id,true);
   assert.equal(loadCopilotPlaybook(db,user.id,row.id,{availableToolNames:[]}),undefined);
   repo.update(row.id,{version:'1.0.0',content:'custom old text'});
   assert.equal(loadCopilotPlaybook(db,user.id,row.id,options),undefined);
   const stale=listCopilotPlaybooks(db,user.id,options).find(s=>s.id===row.id)!;
   assert.equal(stale.reviewRequired,true);assert.equal(stale.currentVersion,'2.0.0');assert.equal(stale.content,'custom old text');
   assert.equal(stale.version,'1.0.0');
   await assert.rejects(()=>load.execute({name:row.name},context));
  }finally{db.close();}
 });
 it('rejects CLI IDs and private foreign IDs, and resolves shared duplicate names by ID',()=>{
  const {db,user,repo}=fixture();try{
   const own=listCopilotPlaybooks(db,user.id,options).find(s=>s.name==='session-dispatch')!;
   const cli=new SkillRepository(db,user.id).create({name:own.name,content:'CLI content'});
   assert.equal(loadCopilotPlaybook(db,user.id,cli.id,options),undefined);
   const other=new UserRepository(db).create('other-skills@test.dev','hash');
   const foreign=new SkillRepository(db,other.id,'copilot');
   const shared=foreign.create({name:own.name,description:'distinct shared metadata',content:'shared body',version:'2.0.0',visibility:'shared'});
   const privateRow=foreign.create({name:'private',content:'private body'});
   assert.equal(loadCopilotPlaybook(db,user.id,privateRow.id,options),undefined);
   assert.equal(loadCopilotPlaybook(db,user.id,shared.id,options)?.content,'shared body');
   assert.equal(loadCopilotPlaybook(db,user.id,own.id,options)?.content,own.content);
   assert.equal(repo.toggle(shared.id,false),undefined);
   assert.equal(repo.update(shared.id,{content:'attack'}),undefined);
  }finally{db.close();}
 });
 it('allows Grant-bound loads only for current exact bundled name, metadata and body',()=>{
  const {db,user,repo}=fixture();try{
   const rows=listCopilotPlaybooks(db,user.id,{...options,grantBound:true});
   assert.equal(rows.filter(s=>s.available).length,6);
   const row=rows.find(s=>s.name==='session-dispatch')!;
   repo.update(row.id,{description:'Do unapproved work',source:'builtin'});
   assert.equal(loadCopilotPlaybook(db,user.id,row.id,{...options,grantBound:true}),undefined);
   repo.update(row.id,{description:row.description,content:row.content+'\nInjected instructions'});
   assert.equal(loadCopilotPlaybook(db,user.id,row.id,{...options,grantBound:true}),undefined);
   assert.ok(loadCopilotPlaybook(db,user.id,row.id,options));
   assert.equal(listEnabledCopilotPlaybookSummaries(db,user.id,{grantBound:true}).length,0);
  }finally{db.close();}
 });
 it('keeps actual handbook tools consistent and removes unsupported execution promises',()=>{
  for (const row of BUILTIN_COPILOT_SKILLS) {
   assert.ok(row.body.length>200);assert.ok(!row.body.includes('dispatch_task_to_session'));
   assert.ok(!row.body.includes('pm_start_task_packet'));
   assert.ok(row.requiredTools.every(name=>availableToolNames.includes(name)));
  }
  const pm=BUILTIN_COPILOT_SKILLS.find(s=>s.name==='autonomous-work-item-loop')!;
  assert.match(pm.body,/DOES NOT start/);assert.match(pm.body,/Grant/);
 });
 it('keeps frontmatter parsing for CLI callers',()=>{
  assert.equal(stripFrontmatter('---\nname: x\n---\n# X'),'# X');
  assert.equal(stripFrontmatter('# X'),'# X');
 });
});
