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
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { ProjectSkillRepository } from '../src/db/repositories/project-skill-repository.js';
import { LEGACY_COPILOT_SKILLS } from '../src/services/agent/skills/legacy-copilot-skills.js';
import { listCopilotPlaybooks } from '../src/services/agent/skills/skill-queries.js';
const migrationsFolder = new URL('../src/db/migrations/',import.meta.url).pathname;

it('upgrades populated 0081 preserving identities, overrides, disable state, custom edits; reopens and restores a backup', async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'fb-playbook-migrate-'));
 let db:Database.Database|undefined;
 try {
  const old=path.join(dir,'old');mkdirSync(path.join(old,'meta'),{recursive:true});
  const journal=JSON.parse(readFileSync(path.join(migrationsFolder,'meta/_journal.json'),'utf8')) as {entries:{tag:string}[]};
  journal.entries=journal.entries.filter(entry=>Number(entry.tag.slice(0,4))<=81);
  writeFileSync(path.join(old,'meta/_journal.json'),JSON.stringify(journal));
  for(const entry of journal.entries)copyFileSync(path.join(migrationsFolder,entry.tag+'.sql'),path.join(old,entry.tag+'.sql'));
  const dbPath=path.join(dir,'database.db');db=new Database(dbPath);migrate(drizzle(db),{migrationsFolder:old});
  const user=new UserRepository(db).create('upgrade@test.dev','hash');
  const other=new UserRepository(db).create('shared@test.dev','hash');
  const project=new ProjectRepository(db,user.id).create({name:'retained',path:dir,aiTool:'codex'});
  const insert=db.prepare('INSERT INTO skills(id,user_id,name,description,source,content,version,visibility,is_enabled) VALUES (?,?,?,?,?,?,?,?,?)');
  for(const [i,bundled] of LEGACY_COPILOT_SKILLS.entries()) {
   insert.run('legacy-'+i,user.id,bundled.name,bundled.description,'builtin',i===1?bundled.body+'\nUser edited':bundled.body,'1.0.0','private',i===0?0:1);
  }
  insert.run('shared-cli',other.id,'autonomous-work-item-loop','Actual CLI package','local','# CLI owned text','3.0.0','shared',1);
  db.prepare('INSERT INTO project_skills(user_id,project_id,skill_id,is_enabled) VALUES (?,?,?,1)').run(user.id,project.id,'legacy-0');
  db.prepare('INSERT INTO project_skills(user_id,project_id,skill_id,is_enabled) VALUES (?,?,?,0)').run(user.id,project.id,'shared-cli');
  const pref=db.prepare('INSERT INTO copilot_tool_preferences(user_id,tool_name,enabled,updated_at) VALUES (?,?,?,1)');
  for(const name of ['list_skills','load_skill','pm_start_task_packet'])pref.run(user.id,name,0);
  pref.run(user.id,'load_playbook',1); // A previous disable must win over a new-name enable.
  const backup=path.join(dir,'backup.db');await db.backup(backup);
  migrate(drizzle(db),{migrationsFolder});
  const repo=new SkillRepository(db,user.id);const playbookRepo=new SkillRepository(db,user.id,'copilot');
  assert.equal(repo.getById('legacy-0'),undefined);assert.equal(repo.getByName(LEGACY_COPILOT_SKILLS[0]!.name),undefined);
  assert.equal(repo.update('legacy-0',{content:'wrong target'}),undefined);assert.equal(repo.toggle('legacy-0',true),undefined);repo.delete('legacy-0');
  assert.equal(playbookRepo.getById('legacy-0')?.content,LEGACY_COPILOT_SKILLS[0]!.body);
  assert.equal(playbookRepo.getById('shared-cli'),undefined);
  const projected=new ProjectSkillRepository(db,user.id);
  assert.deepEqual(projected.listByProject(project.id).map(s=>[s.skillId,s.isEnabled]),[['shared-cli',false]]);
  assert.equal(projected.setSkill(project.id,'legacy-0',true),undefined);
  assert.equal((db.prepare('SELECT count(*) n FROM project_skills').get() as {n:number}).n,2);
  const catalog=listCopilotPlaybooks(db,user.id,{availableToolNames:[]});
  assert.equal(catalog.find(s=>s.id==='legacy-0')?.isEnabled,false);
  assert.equal(catalog.find(s=>s.id==='legacy-0')?.version,'3.0.0');
  const custom=catalog.find(s=>s.id==='legacy-1')!;assert.equal(custom.reviewRequired,true);
  assert.equal(custom.content,LEGACY_COPILOT_SKILLS[1]!.body+'\nUser edited');
  for(const name of ['list_playbooks','load_playbook','pm_prepare_task_packet'])assert.equal((db.prepare('SELECT enabled FROM copilot_tool_preferences WHERE user_id=? AND tool_name=?').get(user.id,name) as {enabled:number}).enabled,0);
  assert.equal((db.prepare('SELECT count(*) n FROM copilot_tool_preferences WHERE tool_name IN (?,?,?)').get('list_skills','load_skill','pm_start_task_packet') as {n:number}).n,3);
  assert.deepEqual(db.pragma('foreign_key_check'),[]);db.close();db=new Database(dbPath);
  migrate(drizzle(db),{migrationsFolder});
  assert.deepEqual(listCopilotPlaybooks(db,user.id,{availableToolNames:[]}),catalog);
  assert.deepEqual(db.pragma('integrity_check'),[{integrity_check:'ok'}]);
  const restored=new Database(backup);
  try {
   assert.equal((restored.pragma('table_info(skills)') as {name:string}[]).some(c=>c.name==='runtime_target'),false);
   assert.equal((restored.prepare('SELECT content FROM skills WHERE id=?').get('legacy-0') as {content:string}).content,LEGACY_COPILOT_SKILLS[0]!.body);
   migrate(drizzle(restored),{migrationsFolder});
   const legacyProjection = (rows: typeof catalog) => rows.map(({revisionId:_revisionId,updatedAt:_updatedAt,...row})=>row);
   assert.deepEqual(legacyProjection(listCopilotPlaybooks(restored,user.id,{availableToolNames:[]})),legacyProjection(catalog));
  }finally{restored.close();}
 }finally{if(db?.open)db.close();rmSync(dir,{recursive:true,force:true});}
});
