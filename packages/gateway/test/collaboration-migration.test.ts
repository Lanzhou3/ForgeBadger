import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,cpSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';

test('0086 database upgrades and reopens without opting private projects into sharing or execution',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'fb-team-migration-')),migrations=fileURLToPath(new URL('../src/db/migrations',import.meta.url)),old=path.join(root,'old');
 cpSync(migrations,old,{recursive:true});
 const journal=JSON.parse(readFileSync(path.join(old,'meta/_journal.json'),'utf8')) as {entries:Array<{idx:number;tag:string}>};journal.entries=journal.entries.filter(e=>e.idx<86);writeFileSync(path.join(old,'meta/_journal.json'),JSON.stringify(journal));
 const file=path.join(root,'state.db');let db=new Database(file);
 try {
  db.pragma('foreign_keys=ON');migrate(drizzle(db),{migrationsFolder:old});
  db.prepare("INSERT INTO users(id,username,email,password_hash) VALUES('owner','owner','owner@example.invalid','hash')").run();
  db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool) VALUES('private','owner','private',?,'codex')").run(root);
  db.prepare("INSERT INTO sessions(id,user_id,project_id,name,ai_tool,working_dir,attach_token) VALUES('session','owner','private','Session','codex',?,'private-token')").run(root);
  const before=db.prepare('SELECT * FROM projects').all();migrate(drizzle(db),{migrationsFolder:migrations});db.close();db=new Database(file);db.pragma('foreign_keys=ON');
  assert.deepEqual(db.prepare('SELECT * FROM projects').all(),before);assert.equal((db.prepare("SELECT attach_token AS token FROM sessions WHERE id='session'").get() as {token:string}).token,'private-token');
  for(const table of ['collaboration_projects','collaboration_members','delivery_runs','delivery_operations']) assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {n:number}).n,0);
  assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal((db.pragma('integrity_check') as Array<{integrity_check:string}>)[0]?.integrity_check,'ok');
  migrate(drizzle(db),{migrationsFolder:migrations});assert.equal((db.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as {n:number}).n,(JSON.parse(readFileSync(path.join(migrations,'meta/_journal.json'),'utf8')) as {entries:unknown[]}).entries.length);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
