import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,cpSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';

test('0089 preserves existing project/storage and legacy auth while adding fail-closed team fences',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'fb-team-upgrade-')),migrations=fileURLToPath(new URL('../src/db/migrations',import.meta.url)),old=path.join(root,'old');cpSync(migrations,old,{recursive:true});
 const journal=JSON.parse(readFileSync(path.join(old,'meta/_journal.json'),'utf8')) as {entries:Array<{idx:number;tag:string}>};journal.entries=journal.entries.filter(e=>e.idx<88);writeFileSync(path.join(old,'meta/_journal.json'),JSON.stringify(journal));const db=new Database(':memory:');
 try{migrate(drizzle(db),{migrationsFolder:old});for(const id of ['owner','member','admin'])db.prepare('INSERT INTO users(id,username,email,password_hash) VALUES(?,?,?,?)').run(id,id,id+'@upgrade.test','hash');
 db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool) VALUES('p','owner','Project',?,'codex')").run(root);const projects=db.prepare('SELECT * FROM projects').all(),users=db.prepare('SELECT * FROM users').all();migrate(drizzle(db),{migrationsFolder:migrations});assert.deepEqual(db.prepare('SELECT * FROM projects').all(),projects);assert.deepEqual(db.prepare('SELECT * FROM users').all(),users);
 assert.equal((db.prepare('SELECT COUNT(*) AS n FROM teams').get() as {n:number}).n,0);assert.equal((db.prepare('SELECT COUNT(*) AS n FROM user_auth_epochs').get() as {n:number}).n,0);
 db.prepare("INSERT INTO teams(id,user_id,owner_id,name,created_at,updated_at) VALUES('t','owner','owner','Team',1,1)").run();for(const id of ['owner','member','admin'])db.prepare("INSERT INTO team_members(user_id,team_id,member_id,role) VALUES('owner','t',?,'admin')").run(id);
 db.prepare("INSERT INTO team_projects(user_id,team_id,project_user_id,project_id,logical_owner_id) VALUES('owner','t','owner','p','member')").run();
 // The operation fence does not require an executor to be the team administrator.
 db.prepare("INSERT INTO project_manager_work_items(id,user_id,project_id,title,status,priority,created_at,updated_at) VALUES('task','owner','p','Task','todo',0,1,1)").run();
 db.prepare("INSERT INTO delivery_runs(id,user_id,project_id,work_item_id,actor_id,idempotency_key,input_digest,adapter,membership_revision,state,workspace_path,branch,created_at,updated_at) VALUES('run','owner','p','task','member','key','digest','codex',1,'ready',?,'branch',1,1)").run(path.join(root,'workspace'));
 db.prepare("INSERT INTO delivery_operations(run_id,user_id,project_id,kind,phase,expected_commit,created_at) VALUES('run','owner','p','integrate','applying','commit',1)").run();
 assert.throws(()=>db.prepare("UPDATE users SET status='disabled' WHERE id='admin'").run(),/DELIVERY_INTEGRATION_IN_PROGRESS/);assert.throws(()=>db.prepare("UPDATE team_members SET state='leaving' WHERE member_id='member'").run(),/DELIVERY_INTEGRATION_IN_PROGRESS/);assert.throws(()=>db.prepare("UPDATE team_projects SET logical_owner_id='admin' WHERE project_id='p'").run(),/DELIVERY_INTEGRATION_IN_PROGRESS/);
 db.prepare('DELETE FROM delivery_operations').run();db.prepare("UPDATE users SET status='disabled' WHERE id='member'").run();db.prepare("UPDATE users SET status='active' WHERE id='member'").run();assert.equal((db.prepare("SELECT epoch FROM user_authority_epochs WHERE user_id='member'").get() as {epoch:number}).epoch,2);assert.throws(()=>db.prepare("UPDATE users SET status='disabled' WHERE id='owner'").run(),/TEAM_OWNER_TRANSFER_REQUIRED/);
 assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal((db.pragma('integrity_check') as Array<{integrity_check:string}>)[0]?.integrity_check,'ok');
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
