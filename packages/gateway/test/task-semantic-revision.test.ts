import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {UserRepository} from '../src/db/repositories/user-repository.js';
import {ProjectRepository} from '../src/db/repositories/project-repository.js';
import {ProjectManagerRepository} from '../src/db/repositories/project-manager-repository.js';

test('semantic revision advances for every actual requirement or assignment change including ABA, but not progress',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'fb-semantic-')),db=new Database(':memory:');
 try{
  db.pragma('foreign_keys=ON');migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
  const user=new UserRepository(db).create('semantic@test.local','hash'),project=new ProjectRepository(db,user.id).create({name:'test',path:root,aiTool:'codex'});
  const task=new ProjectManagerRepository(db,user.id).createWorkItem(project.id,{title:'A',acceptanceCriteria:['A']});
  const version=()=>((db.prepare('SELECT semantic_revision FROM collaboration_tasks WHERE work_item_id=?').get(task.id) as {semantic_revision:number}|undefined)?.semantic_revision??1);
  assert.equal(version(),1);
  db.prepare('UPDATE project_manager_work_items SET title=? WHERE id=?').run('B',task.id);assert.equal(version(),2);
  db.prepare('UPDATE project_manager_work_items SET title=? WHERE id=?').run('A',task.id);assert.equal(version(),3);
  db.prepare('UPDATE project_manager_work_items SET title=?,status=?,priority=? WHERE id=?').run('A','in_progress',50,task.id);assert.equal(version(),3);
  db.prepare('UPDATE collaboration_tasks SET assignee_id=? WHERE work_item_id=?').run(user.id,task.id);assert.equal(version(),4);
  db.prepare('UPDATE collaboration_tasks SET assignee_id=?,revision=revision+1 WHERE work_item_id=?').run(user.id,task.id);assert.equal(version(),4);
  db.prepare('UPDATE collaboration_tasks SET assignee_id=NULL WHERE work_item_id=?').run(task.id);assert.equal(version(),5);
  assert.throws(()=>db.prepare('UPDATE collaboration_tasks SET semantic_revision=0 WHERE work_item_id=?').run(task.id),/CHECK/);
  assert.equal(db.pragma('foreign_key_check').length,0);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
