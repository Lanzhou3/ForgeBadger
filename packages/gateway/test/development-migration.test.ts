import assert from 'node:assert/strict';
import {it} from 'node:test';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import Database from 'better-sqlite3';import {drizzle} from 'drizzle-orm/better-sqlite3';import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {UserRepository} from '../src/db/repositories/user-repository.js';
import {ProjectRepository} from '../src/db/repositories/project-repository.js';
import {PlatformActions} from '../src/services/platform-commands/actions.js';
import {createPlatformCommands} from '../src/services/platform-commands/catalog.js';
import {DevelopmentTaskRepository} from '../src/db/repositories/development-task-repository.js';
import {hashText} from '../src/services/development/workspace.js';
it('populated0086 upgrade preserves legacy intent evidence and queued identity across reopen and backup restoration',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'development-migration-')),legacy=path.join(dir,'legacy'),root=new URL('../src/db/migrations/',import.meta.url).pathname;
 fs.mkdirSync(path.join(legacy,'meta'),{recursive:true});const journal=JSON.parse(fs.readFileSync(path.join(root,'meta/_journal.json'),'utf8'));journal.entries=journal.entries.filter((e:{tag:string})=>Number(e.tag.slice(0,4))<=86);
 fs.writeFileSync(path.join(legacy,'meta/_journal.json'),JSON.stringify(journal));for(const e of journal.entries)fs.copyFileSync(path.join(root,e.tag+'.sql'),path.join(legacy,e.tag+'.sql'));
 const filename=path.join(dir,'test.db');let db=new Database(filename);
 try{db.pragma('foreign_keys=ON');migrate(drizzle(db),{migrationsFolder:legacy});const user=new UserRepository(db).create('migration-dev@test.local','hash');
  const p=new ProjectRepository(db,user.id).create({name:'fixture',path:dir,aiTool:'codex'});
  db.prepare("INSERT INTO platform_action_intents(id,user_id,actor_user_id,authority,command_id,input_json,digest,resources_json,policy_version,expires_at,idempotency_key,status,created_at) VALUES (?,?,?,'owner_action','project.metadata.update','{}','digest','{}',1,?,'legacy-key','completed',?)").run('legacy',user.id,user.id,Date.now()+60000,Date.now());
  db.prepare("INSERT INTO platform_action_receipts(intent_id,user_id,outcome,result_json,created_at) VALUES (?,?,'confirmed','{}',?)").run('legacy',user.id,Date.now());
  const oldIntent=db.prepare('SELECT * FROM platform_action_intents').get() as Record<string,unknown>;const oldReceipt=JSON.stringify(db.prepare('SELECT * FROM platform_action_receipts').all());
  await db.backup(path.join(dir,'before.db'));migrate(drizzle(db),{migrationsFolder:root});migrate(drizzle(db),{migrationsFolder:root});
  assert.ok(JSON.stringify(db.prepare('SELECT * FROM platform_action_receipts').all())===oldReceipt);
  const after=db.prepare('SELECT * FROM platform_action_intents WHERE id=?').get('legacy') as Record<string,unknown>;for(const [key,value] of Object.entries(oldIntent))assert.ok(after[key]===value,key+' changed');assert.equal(after.origin_kind,'legacy');assert.equal(after.origin_run_id,null);
  fs.writeFileSync(path.join(dir,'f.cjs'),'module.exports=0;');const test="require('node:assert/strict').equal(require('./f.cjs'),1);";fs.writeFileSync(path.join(dir,'test.cjs'),test);
  const actions=new PlatformActions({db,userId:user.id,actionOrigin:{kind:'owner_api'}},createPlatformCommands());const result=await actions.executeOwner('development.task.submit',{projectId:p.id,goal:'fixture',sourceFiles:['f.cjs','test.cjs'],changes:[{path:'f.cjs',beforeSha256:hashText('module.exports=0;'),content:'module.exports=1;'}],checks:[{path:'test.cjs',sha256:hashText(test)}]},'queued') as {taskId:string};
  await db.backup(path.join(dir,'after.db'));db.close();db=new Database(filename);assert.equal(new DevelopmentTaskRepository(db,user.id).get(result.taskId)?.status,'queued');assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.equal(db.pragma('foreign_key_check').length,0);
  db.close();fs.copyFileSync(path.join(dir,'before.db'),filename);db=new Database(filename);assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='copilot_development_tasks'").get(),undefined);assert.ok(JSON.stringify(db.prepare('SELECT * FROM platform_action_receipts').all())===oldReceipt);
  migrate(drizzle(db),{migrationsFolder:root});assert.equal(db.prepare('SELECT origin_kind FROM platform_action_intents WHERE id=?').get('legacy').origin_kind,'legacy');
  db.close();fs.copyFileSync(path.join(dir,'after.db'),filename);db=new Database(filename);assert.equal(new DevelopmentTaskRepository(db,user.id).get(result.taskId)?.status,'queued');
 }finally{if(db.open)db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
it('0089 team records remain unchanged across the forward 0090 migration',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'development-team-migration-')),legacy=path.join(dir,'legacy'),root=new URL('../src/db/migrations/',import.meta.url).pathname;
 fs.mkdirSync(path.join(legacy,'meta'),{recursive:true});const journal=JSON.parse(fs.readFileSync(path.join(root,'meta/_journal.json'),'utf8'));journal.entries=journal.entries.filter((e:{tag:string})=>Number(e.tag.slice(0,4))<=89);
 fs.writeFileSync(path.join(legacy,'meta/_journal.json'),JSON.stringify(journal));for(const e of journal.entries)fs.copyFileSync(path.join(root,e.tag+'.sql'),path.join(legacy,e.tag+'.sql'));
 const db=new Database(path.join(dir,'test.db'));try{
  db.pragma('foreign_keys=ON');migrate(drizzle(db),{migrationsFolder:legacy});const user=new UserRepository(db).create('team-migration@test.local','hash');const project=new ProjectRepository(db,user.id).create({name:'team fixture',path:dir,aiTool:'codex'});
  db.prepare('INSERT INTO collaboration_projects(project_id,user_id,protected_root,revision) VALUES (?,?,?,7)').run(project.id,user.id,dir);
  const before=JSON.stringify(db.prepare('SELECT * FROM collaboration_projects').all());migrate(drizzle(db),{migrationsFolder:root});
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM collaboration_projects').all()),before);assert.equal(new ProjectRepository(db,user.id).getById(project.id)?.name,'team fixture');assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.equal(db.pragma('foreign_key_check').length,0);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='copilot_development_tasks'").get());
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
