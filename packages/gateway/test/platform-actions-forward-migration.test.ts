import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { CopilotConversationLog } from '../src/services/agent/conversation-log.js';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../src/db/migrations/',import.meta.url));
const appliedHash='3aaad007c30e8ed3fb51f7a4a3124cf301b75fb6dca49ad7a87e657095cb8944';
function journalTo(dir:string,maxTag:number){
 mkdirSync(path.join(dir,'meta'));
 const journal=JSON.parse(readFileSync(path.join(root,'meta/_journal.json'),'utf8')) as {entries:{tag:string}[]};journal.entries=journal.entries.filter(e=>Number(e.tag.slice(0,4))<=maxTag);
 writeFileSync(path.join(dir,'meta/_journal.json'),JSON.stringify(journal));for(const e of journal.entries)copyFileSync(path.join(root,e.tag+'.sql'),path.join(dir,e.tag+'.sql'));
}
// Mirrors the production upgrade harness in src/db/client.ts (initializeDatabase):
// drizzle runs migrations inside one transaction where PRAGMA foreign_keys is a no-op,
// so the pragma must be toggled on the connection around migrate().
function upgrade(db:Database.Database){
 db.pragma('foreign_keys = OFF');
 try{migrate(drizzle(db),{migrationsFolder:root});}
 finally{db.pragma('foreign_keys = ON');}
}
function fixture(){
 const dir=mkdtempSync(path.join(tmpdir(),'copilot-forward-0069-'));const db=new Database(':memory:');
 journalTo(dir,69);
 migrate(drizzle(db),{migrationsFolder:dir});
 const user=new UserRepository(db).create('forward@test.dev','hash');const log=new CopilotConversationLog(db,user.id);const conversation=log.createConversation('Retained');
 const grantId='retained-grant';
 db.prepare("INSERT INTO copilot_grants(id,user_id,actor_user_id,name,scope_json,expires_at,max_actions,max_concurrency,created_at) VALUES (?,?,?,'Retained grant',?,?,?,?,?)").run(grantId,user.id,user.id,'{"projectIds":[],"capabilities":["memory.write"],"allowedRoots":[]}',Date.now()+100000,10,1,1230);
 db.prepare('INSERT INTO copilot_conversation_grants(conversation_id,user_id,grant_id,created_at) VALUES (?,?,?,?)').run(conversation.id,user.id,grantId,1231);
 const insert=db.prepare("INSERT INTO platform_action_intents(id,user_id,actor_user_id,grant_id,authority,command_id,input_json,digest,resources_json,policy_version,expires_at,idempotency_key,status,created_at) VALUES (?,?,?,?,'owner_action','memory.write',?,'digest','{}',1,?,?,?,?)");
 insert.run('completed',user.id,user.id,grantId,'{"text":"retained evidence"}',Date.now()+100000,'retained-key','completed',1234);
 insert.run('interrupted',user.id,user.id,grantId,'{"text":"do not replay"}',Date.now()+100000,'interrupted-key','executing',1235);
 db.prepare("INSERT INTO platform_action_receipts(intent_id,user_id,outcome,result_json,created_at) VALUES (?,?,'confirmed',?,?)").run('completed',user.id,'{"retained":true}',1236);
 return {db,dir,user,conversation,grantId,close(){db.close();rmSync(dir,{recursive:true,force:true});}};
}
it('retains the exact already-applied 0069 bytes',()=>{assert.equal(createHash('sha256').update(readFileSync(path.join(root,'0069_copilot_platform_actions.sql'))).digest('hex'),appliedHash);});
it('upgrades the original 0069, removes the grant tables and grant columns, and retains receipts and unknown-effect evidence',()=>{
 const f=fixture();try{
 assert.equal((f.db.prepare('SELECT hash FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1').get() as {hash:string}).hash,appliedHash);
 assert.equal(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='session_writer_leases'").get(),undefined);
 assert.ok(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='copilot_grants'").get());
 assert.ok(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='copilot_conversation_grants'").get());
 upgrade(f.db);
 assert.equal(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='copilot_grants'").get(),undefined);
 assert.equal(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='copilot_conversation_grants'").get(),undefined);
 const intentCols=(f.db.pragma('table_info(platform_action_intents)') as {name:string}[]).map(c=>c.name);
 assert.ok(!intentCols.includes('grant_id')&&!intentCols.includes('grant_revision'));
 assert.ok(intentCols.includes('execution_lease_expires_at')&&intentCols.includes('execution_owner'));
 assert.ok(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='session_writer_leases'").get());
 assert.equal((f.db.prepare('SELECT result_json FROM platform_action_receipts WHERE intent_id=?').get('completed') as {result_json:string}).result_json,'{"retained":true}');
 assert.equal((f.db.prepare('SELECT status FROM platform_action_intents WHERE id=?').get('completed') as {status:string}).status,'completed');
 assert.equal((f.db.prepare('SELECT status FROM platform_action_intents WHERE id=?').get('interrupted') as {status:string}).status,'indeterminate');
 assert.equal((f.db.prepare('SELECT count(*) n FROM platform_action_intents').get() as {n:number}).n,2);
 assert.ok((f.db.pragma('table_info(projects)') as {name:string}[]).some(c=>c.name==='copilot_autonomy'));
 const routeCols=(f.db.pragma('table_info(channel_routes)') as {name:string}[]).map(c=>c.name);
 assert.ok(routeCols.includes('project_id')&&!routeCols.includes('grant_id')&&!routeCols.includes('grant_revision'));
 assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
 assert.equal((f.db.prepare('SELECT hash FROM __drizzle_migrations WHERE created_at=?').get(1788393600202) as {hash:string}).hash,appliedHash);
 f.db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run('proj-1',f.user.id,'Autonomy','/tmp/autonomy','claude',1600,1601);
 const repos=new ProjectRepository(f.db,f.user.id);
 assert.equal(repos.getCopilotAutonomy('proj-1'),false);
 assert.equal(repos.setCopilotAutonomy('proj-1',true)?.copilotAutonomy,true);
 const foreign=new UserRepository(f.db).create('foreign-autonomy@test.dev','hash');
 const foreignRepos=new ProjectRepository(f.db,foreign.id);
 assert.equal(foreignRepos.getCopilotAutonomy('proj-1'),undefined);
 assert.equal(foreignRepos.setCopilotAutonomy('proj-1',false),undefined);
 assert.equal(repos.getCopilotAutonomy('proj-1'),true);
 upgrade(f.db);assert.equal((f.db.prepare('SELECT count(*) n FROM platform_action_receipts').get() as {n:number}).n,1);
 }finally{f.close();}
});
it('refuses an invalid historical tenant binding without dropping its row or advancing migration state',()=>{
 const f=fixture();try{
 const other=new UserRepository(f.db).create('foreign-forward@test.dev','hash');const foreign=new CopilotConversationLog(f.db,other.id).createConversation();
 f.db.prepare('UPDATE copilot_conversation_grants SET conversation_id=? WHERE conversation_id=?').run(foreign.id,f.conversation.id);
 assert.throws(()=>upgrade(f.db));
 assert.equal((f.db.prepare('SELECT conversation_id FROM copilot_conversation_grants WHERE user_id=?').get(f.user.id) as {conversation_id:string}).conversation_id,foreign.id);
 assert.equal((f.db.prepare('SELECT hash FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1').get() as {hash:string}).hash,appliedHash);
 }finally{f.close();}
});
it('drops legacy channel routes bound to grants and rebinds the table to projects',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'copilot-forward-0078-'));const db=new Database(':memory:');try{
 journalTo(dir,78);
 migrate(drizzle(db),{migrationsFolder:dir});
 const user=new UserRepository(db).create('routes@test.dev','hash');const conversation=new CopilotConversationLog(db,user.id).createConversation('Routed');
 const grantId='route-grant';
 db.prepare("INSERT INTO copilot_grants(id,user_id,actor_user_id,name,scope_json,expires_at,max_actions,max_concurrency,created_at) VALUES (?,?,?,'Route grant','{}',?,10,1,?)").run(grantId,user.id,user.id,Date.now()+100000,1400);
 db.prepare('INSERT INTO channel_identities(id,user_id,channel,account_id,account_revision,external_user_id,chat_id,created_at) VALUES (?,?,?,?,?,?,?,?)').run('ident-1',user.id,'feishu','account-1',1,'external-1','chat-1',1401);
 db.prepare('INSERT INTO channel_routes(id,user_id,identity_id,grant_id,grant_revision,conversation_id,created_at) VALUES (?,?,?,?,?,?,?)').run('route-1',user.id,'ident-1',grantId,1,conversation.id,1402);
 assert.equal((db.prepare('SELECT count(*) n FROM channel_routes').get() as {n:number}).n,1);
 upgrade(db);
 assert.equal((db.prepare('SELECT count(*) n FROM channel_routes').get() as {n:number}).n,0);
 const routeCols=(db.pragma('table_info(channel_routes)') as {name:string}[]).map(c=>c.name);
 assert.ok(routeCols.includes('project_id')&&!routeCols.includes('grant_id')&&!routeCols.includes('grant_revision'));
 assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='copilot_grants'").get(),undefined);
 assert.deepEqual(db.pragma('foreign_key_check'),[]);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
it('builds the same final schema from a fresh database',()=>{const db=new Database(':memory:');try{migrate(drizzle(db),{migrationsFolder:root});
 assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='copilot_grants'").get(),undefined);
 assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='copilot_conversation_grants'").get(),undefined);
 const intentCols=(db.pragma('table_info(platform_action_intents)') as {name:string}[]).map(c=>c.name);
 assert.ok(intentCols.includes('execution_owner')&&!intentCols.includes('grant_id')&&!intentCols.includes('grant_revision'));
 assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='session_writer_leases'").get());
 assert.ok((db.pragma('table_info(projects)') as {name:string}[]).some(c=>c.name==='copilot_autonomy'));
 assert.ok((db.pragma('table_info(channel_routes)') as {name:string}[]).some(c=>c.name==='project_id'));
 assert.deepEqual(db.pragma('foreign_key_check'),[]);
 }finally{db.close();}});
