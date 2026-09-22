import assert from 'node:assert/strict';
import { it } from 'node:test';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { SkillRepository } from '../src/db/repositories/skill-repository.js';
import { CopilotSkillService } from '../src/services/agent/skills/copilot-skill-service.js';
import { CopilotSkillRevisionRepository } from '../src/db/repositories/copilot-skill-revision-repository.js';
import { BUILTIN_COPILOT_SKILLS } from '../src/services/agent/skills/copilot-skills.js';
import { LEGACY_COPILOT_SKILLS } from '../src/services/agent/skills/legacy-copilot-skills.js';
const currentMigrations=new URL('../src/db/migrations/',import.meta.url).pathname;

it('upgrades populated0084 and retains edited/disabled builtin identity, immutable history, reopen and backup restore',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'fb-skill-history-'));let db:Database.Database|undefined;
 try {
  const old=path.join(root,'old');mkdirSync(path.join(old,'meta'),{recursive:true});
  const journal=JSON.parse(readFileSync(path.join(currentMigrations,'meta/_journal.json'),'utf8')) as {entries:{tag:string}[]};
  journal.entries=journal.entries.filter(entry=>Number(entry.tag.slice(0,4))<=84);
  writeFileSync(path.join(old,'meta/_journal.json'),JSON.stringify(journal));
  for(const entry of journal.entries)copyFileSync(path.join(currentMigrations,entry.tag+'.sql'),path.join(old,entry.tag+'.sql'));
  const filename=path.join(root,'state.db');db=new Database(filename);migrate(drizzle(db),{migrationsFolder:old});
  const user=new UserRepository(db).create('history-upgrade@test.dev','hash');
  const repo=new SkillRepository(db,user.id,'copilot');
  const canonical=LEGACY_COPILOT_SKILLS[0]!;
  const untouched=repo.create({name:canonical.name,description:canonical.description,content:canonical.body,source:'builtin',version:'1.0.0',isEnabled:false});
  const legacy=BUILTIN_COPILOT_SKILLS.find(row=>row.name==='safety-and-approvals')!;
  const edited=repo.create({name:legacy.name,description:legacy.description,content:legacy.body+'\nUser retained edit',source:'builtin',version:'1.0.0',isEnabled:false});
  const cli=new SkillRepository(db,user.id).create({name:legacy.name,content:'Retained CLI package'});
  const backup=path.join(root,'before-upgrade.db');await db.backup(backup);
  migrate(drizzle(db),{migrationsFolder:currentMigrations});
  assert.equal(new SkillRepository(db,user.id,'copilot').getById(edited.id)?.content,edited.content);
  let service=new CopilotSkillService(db,user.id);const first=service.get(edited.id)!;
  assert.equal(first.id,edited.id);assert.equal(first.version,'1.0.0');assert.equal(first.reviewRequired,true);assert.equal(first.isEnabled,false);
  assert.equal(first.content,edited.content);assert.equal(first.kind,'builtin-playbook');
  const untouchedHistory=service.revisions(untouched.id);assert.equal(untouchedHistory.length,2);
  const oldRevision=untouchedHistory.find(revision=>revision.version==='1.0.0')!;
  const active=service.get(untouched.id)!;
  const reverted=service.rollback(untouched.id,oldRevision.id,active.revisionId);
  assert.equal(reverted.content,canonical.body);assert.equal(reverted.reviewRequired,true);
  assert.equal(service.get(untouched.id)!.revisionId,reverted.revisionId); // Reading cannot silently undo an explicit rollback.
  const reviewed=service.updateLegacy(edited.id,edited.content,legacy.version);
  assert.equal(reviewed.isEnabled,false);assert.equal(reviewed.reviewRequired,false);assert.equal(service.revisions(edited.id).length,2);
  assert.equal(service.revision(edited.id,first.revisionId)!.files[0]!.content.includes('User retained edit'),true);
  assert.throws(()=>db!.prepare('UPDATE copilot_skill_revisions SET snapshot_json=? WHERE id=?').run('{}',first.revisionId),/immutable/);
  assert.throws(()=>db!.prepare('UPDATE copilot_skill_heads SET origin_kind=? WHERE skill_id=?').run('external',edited.id),/immutable/);
  const revisionRepo=new CopilotSkillRevisionRepository(db,user.id);
  assert.throws(()=>revisionRepo.initialize(cli.id,'external',{name:'x',description:'x',version:'1',content:'x',files:[],source:{kind:'paste'},requiredTools:[],incompatibilityReasons:[]}),/target required/);
  const captured=service.get(edited.id)!;const capturedRevisions=service.revisions(edited.id);
  const postBackup=path.join(root,'with-revisions.db');await db.backup(postBackup);
  assert.deepEqual(db.pragma('foreign_key_check'),[]);db.close();db=new Database(filename);migrate(drizzle(db),{migrationsFolder:currentMigrations});service=new CopilotSkillService(db,user.id);
  assert.deepEqual(service.get(edited.id),captured);assert.deepEqual(service.revisions(edited.id),capturedRevisions);
  assert.equal(new SkillRepository(db,user.id).getById(cli.id)?.content,'Retained CLI package');
  const restored=new Database(postBackup);try{migrate(drizzle(restored),{migrationsFolder:currentMigrations});assert.deepEqual(new CopilotSkillService(restored,user.id).get(edited.id),captured);assert.deepEqual(restored.pragma('integrity_check'),[{integrity_check:'ok'}]);}finally{restored.close();}
  const original=new Database(backup);try{
   assert.equal((original.pragma('table_info(copilot_skill_heads)') as unknown[]).length,0);
   assert.equal(new SkillRepository(original,user.id,'copilot').getById(edited.id)?.content,edited.content);
   migrate(drizzle(original),{migrationsFolder:currentMigrations});
   const reopened=new CopilotSkillService(original,user.id).get(edited.id)!;assert.equal(reopened.id,edited.id);assert.equal(reopened.content,edited.content);assert.equal(reopened.isEnabled,false);
  }finally{original.close();}
 }finally{if(db?.open)db.close();rmSync(root,{recursive:true,force:true});}
});
