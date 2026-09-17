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
import { CopilotGrantRepository } from '../src/db/repositories/copilot-grant-repository.js';
import { CopilotConversationLog } from '../src/services/agent/conversation-log.js';
const root=new URL('../src/db/migrations/',import.meta.url).pathname;
const appliedHash='3aaad007c30e8ed3fb51f7a4a3124cf301b75fb6dca49ad7a87e657095cb8944';
function fixture(){
 const dir=mkdtempSync(path.join(tmpdir(),'copilot-forward-0070-'));const db=new Database(':memory:');
 mkdirSync(path.join(dir,'meta'));
 const journal=JSON.parse(readFileSync(path.join(root,'meta/_journal.json'),'utf8')) as {entries:{tag:string}[]};journal.entries=journal.entries.filter(e=>Number(e.tag.slice(0,4))<=69);
 writeFileSync(path.join(dir,'meta/_journal.json'),JSON.stringify(journal));for(const e of journal.entries)copyFileSync(path.join(root,e.tag+'.sql'),path.join(dir,e.tag+'.sql'));
 migrate(drizzle(db),{migrationsFolder:dir});
 const user=new UserRepository(db).create('forward@test.dev','hash');const log=new CopilotConversationLog(db,user.id);const conversation=log.createConversation('Retained');
 const grants=new CopilotGrantRepository(db,user.id);const grant=grants.create({name:'Retained grant',scope:{projectIds:[],capabilities:['memory.write'],allowedRoots:[]},expiresAt:Date.now()+100000,maxActions:10,maxConcurrency:1});grants.bind(conversation.id,grant.id);
 const insert=db.prepare("INSERT INTO platform_action_intents(id,user_id,actor_user_id,authority,command_id,input_json,digest,resources_json,policy_version,expires_at,idempotency_key,status,created_at) VALUES (?,?,?,'owner_action','memory.write',?,'digest','{}',1,? ,?,?,?)");
 insert.run('completed',user.id,user.id,'{"text":"retained evidence"}',Date.now()+100000,'retained-key','completed',1234);
 insert.run('interrupted',user.id,user.id,'{"text":"do not replay"}',Date.now()+100000,'interrupted-key','executing',1235);
 db.prepare("INSERT INTO platform_action_receipts(intent_id,user_id,outcome,result_json,created_at) VALUES (?,?,'confirmed',?,?)").run('completed',user.id,'{"retained":true}',1236);
 return {db,dir,user,conversation,grant,close(){db.close();rmSync(dir,{recursive:true,force:true});}};
}
it('retains the exact already-applied 0069 bytes',()=>{assert.equal(createHash('sha256').update(readFileSync(path.join(root,'0069_copilot_platform_actions.sql'))).digest('hex'),appliedHash);});
it('upgrades the original 0069 without losing grants, bindings, completed receipts or unknown-effect evidence',()=>{
 const f=fixture();try{
 assert.equal((f.db.prepare('SELECT hash FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1').get() as {hash:string}).hash,appliedHash);
 assert.equal(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='session_writer_leases'").get(),undefined);
 migrate(drizzle(f.db),{migrationsFolder:root});
 assert.equal(new CopilotGrantRepository(f.db,f.user.id).binding(f.conversation.id),f.grant.id);
 assert.equal((f.db.prepare('SELECT result_json FROM platform_action_receipts WHERE intent_id=?').get('completed') as {result_json:string}).result_json,'{"retained":true}');
 assert.equal((f.db.prepare('SELECT status FROM platform_action_intents WHERE id=?').get('completed') as {status:string}).status,'completed');
 assert.equal((f.db.prepare('SELECT status,input_json FROM platform_action_intents WHERE id=?').get('interrupted') as {status:string}).status,'indeterminate');
 assert.ok(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='session_writer_leases'").get());
 assert.ok((f.db.pragma('table_info(platform_action_intents)') as {name:string}[]).some(c=>c.name==='execution_lease_expires_at'));
 const fk=f.db.pragma('foreign_key_list(copilot_conversation_grants)') as {table:string;from:string;to:string}[];
 assert.ok(fk.some(c=>c.table==='copilot_conversations'&&c.from==='user_id'&&c.to==='user_id'));
 assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
 assert.equal((f.db.prepare('SELECT hash FROM __drizzle_migrations WHERE created_at=?').get(1788393600202) as {hash:string}).hash,appliedHash);
 migrate(drizzle(f.db),{migrationsFolder:root});assert.equal((f.db.prepare('SELECT count(*) n FROM platform_action_receipts').get() as {n:number}).n,1);
 }finally{f.close();}
});
it('refuses an invalid historical tenant binding without dropping its row or advancing migration state',()=>{
 const f=fixture();try{
 const other=new UserRepository(f.db).create('foreign-forward@test.dev','hash');const foreign=new CopilotConversationLog(f.db,other.id).createConversation();
 f.db.prepare('UPDATE copilot_conversation_grants SET conversation_id=? WHERE conversation_id=?').run(foreign.id,f.conversation.id);
 assert.throws(()=>migrate(drizzle(f.db),{migrationsFolder:root}));
 assert.equal((f.db.prepare('SELECT conversation_id FROM copilot_conversation_grants WHERE user_id=?').get(f.user.id) as {conversation_id:string}).conversation_id,foreign.id);
 assert.equal((f.db.prepare('SELECT hash FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1').get() as {hash:string}).hash,appliedHash);
 }finally{f.close();}
});
it('builds the same final schema from a fresh database',()=>{const db=new Database(':memory:');try{migrate(drizzle(db),{migrationsFolder:root});assert.ok((db.pragma('table_info(platform_action_intents)') as {name:string}[]).some(c=>c.name==='execution_owner'));assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='session_writer_leases'").get());assert.deepEqual(db.pragma('foreign_key_check'),[]);}finally{db.close();}});
