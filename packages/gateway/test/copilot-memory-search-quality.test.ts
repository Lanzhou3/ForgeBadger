import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { mkdtempSync,rmSync,mkdirSync,readFileSync,writeFileSync,copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from "node:url";
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { startCopilotRuntime } from '../src/services/agent/runtime.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { AgentMemoryRepository } from '../src/services/agent/memory.js';

function fixture(t:TestContext) {
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');
  migrate(drizzle(db),{migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url))});
  const userId=new UserRepository(db).create('search-quality@example.invalid','hash').id;
  t.after(()=>db.close());
  return {db,userId,memory:new AgentMemoryRepository(db,userId)};
}

it('preserves subject words and single-word searches without substring false positives',t=>{
  const {memory}=fixture(t);
  const user=memory.create({scope:'global',kind:'fact',text:'用户权限：只读访问 focus。'});
  memory.create({scope:'global',kind:'fact',text:'管理员权限：可以删除项目。'});
  for(const query of ['用户','用户权限'])assert.deepEqual(memory.search(query,{scope:'global'}).map(row=>row.id),[user.id]);
  assert.deepEqual(memory.search('用户 us',{scope:'global'}),[],'us must not match inside focus');
});
it('normalizes indexed text and queries identically across scripts and character widths',t=>{
  const {memory}=fixture(t);
  const entry=memory.create({scope:'global',kind:'fact',text:'用户使用 ＰＮＰＭ 管理依赖；界面标题为 ΑΛΦΑ。'});
  for(const query of ['pnpm 用户','ＰＮＰＭ 用户','αλφα 用户'])assert.deepEqual(memory.search(query,{scope:'global'}).map(row=>row.id),[entry.id]);
});
it('does not silently drop a trailing subject or negation from an explicit search',t=>{
  const {memory}=fixture(t);
  const sentence=Array.from({length:24},(_,i)=>`word${i}`).join(' ');
  memory.create({scope:'global',kind:'fact',text:sentence});
  assert.throws(()=>memory.search(sentence+' forbidden',{scope:'global'}),/QUERY_TOO_LONG/);
  assert.throws(()=>memory.search('a'.repeat(513),{scope:'global'}),/QUERY_TOO_LONG/);
  const negative=memory.create({scope:'global',kind:'fact',text:'不要 删除 用户。'});
  memory.create({scope:'global',kind:'fact',text:'允许 删除 用户。'});
  assert.deepEqual(memory.search('不要 删除 用户',{scope:'global'}).map(row=>row.id),[negative.id]);
});
it('ranks a rare relevant term before memories matching only a common subject',t=>{
  const {memory}=fixture(t);
  const relevant=memory.create({scope:'global',kind:'decision',text:'项目使用 pnpm 管理依赖。'});
  for(let i=0;i<12;i++)memory.create({scope:'global',kind:'fact',text:`用户偏好界面主题，记录 ${i}。`});
  const rows=memory.searchMulti([{scope:'global'}],'用户 pnpm',3);
  assert.equal(rows[0]?.id,relevant.id);
});
it('indexes full memory text beyond the query budget while retaining repeated words',t=>{
  const {memory}=fixture(t);
  const entry=memory.create({scope:'global',kind:'fact',text:'普通说明 '.repeat(180)+'末尾诊断词 terminalmarker'});
  assert.deepEqual(memory.search('terminalmarker 诊断',{scope:'global'}).map(row=>row.id),[entry.id]);
});

it('does not return partial scopes while historical indexes rebuild across batches',t=>{
  const {db,userId,memory}=fixture(t);
  const original=[];
  for(let i=0;i<65;i++)original.push(memory.create({scope:'global',kind:'fact',text:i===64?'历史记忆 legacyneedle':`历史条目 record${i}`}));
  db.prepare('DELETE FROM copilot_memory_search_index WHERE user_id=?').run(userId);
  db.prepare('DELETE FROM copilot_memory_fts WHERE user_id=?').run(userId);
  db.prepare("INSERT INTO copilot_memory_fts(memory_id,user_id,scope,project_id,kind,text) SELECT id,user_id,scope,COALESCE(project_id,''),kind,text FROM copilot_memory WHERE user_id=?").run(userId);
  const project=new ProjectRepository(db,userId).create({name:'P',path:'/tmp/memory-index-fixture',aiTool:'codex'});
  const scoped=memory.create({scope:'project',projectId:project.id,kind:'fact',text:'scoped legacyneedle'});
  const scopes=[{scope:'project' as const,projectId:project.id},{scope:'global' as const}];
  assert.throws(()=>memory.searchMulti(scopes,'legacyneedle'),/INDEX_BUILDING/);
  assert.equal((db.prepare('SELECT count(*) n FROM copilot_memory_search_index WHERE user_id=?').get(userId) as {n:number}).n,65);
  assert.deepEqual(new Set(memory.searchMulti(scopes,'legacyneedle').map(row=>row.id)),new Set([scoped.id,original[64]!.id]));
  for(const row of original)assert.equal(memory.get(row.id)!.text,row.text);
});
it('rolls back an index batch on failure and rechecks tokenizer versions',t=>{
  const {db,userId,memory}=fixture(t);
  const entry=memory.create({scope:'global',kind:'fact',text:'中文记忆 用户权限'});
  db.prepare('DELETE FROM copilot_memory_search_index WHERE user_id=?').run(userId);
  db.exec("CREATE TRIGGER fail_index BEFORE INSERT ON copilot_memory_search_index BEGIN SELECT RAISE(ABORT,'fixture index failure'); END;");
  const before=db.prepare('SELECT * FROM copilot_memory_fts WHERE user_id=?').all(userId);
  assert.throws(()=>memory.search('用户权限',{scope:'global'}),/fixture index failure/);
  assert.deepEqual(db.prepare('SELECT * FROM copilot_memory_fts WHERE user_id=?').all(userId),before);
  assert.equal((db.prepare('SELECT count(*) n FROM copilot_memory_search_index').get() as {n:number}).n,0);
  db.exec('DROP TRIGGER fail_index');
  assert.equal(memory.search('用户权限',{scope:'global'})[0]!.id,entry.id);
  db.prepare("UPDATE copilot_memory_search_index SET version='old-icu' WHERE user_id=?").run(userId);
  db.prepare("UPDATE copilot_memory_fts SET text='unrelated' WHERE user_id=?").run(userId);
  assert.equal(memory.search('用户权限',{scope:'global'})[0]!.id,entry.id);
});
it('enforces index tenant ownership and cleans indexes on both normal and cascade deletion',t=>{
  const {db,userId,memory}=fixture(t),other=new UserRepository(db).create('other-index@example.invalid','hash').id;
  const entry=memory.create({scope:'global',kind:'fact',text:'用户权限'});
  assert.throws(()=>db.prepare('INSERT INTO copilot_memory_search_index(user_id,memory_id,version) VALUES(?,?,?)').run(other,entry.id,'forged'),/FOREIGN KEY/);
  assert.deepEqual(new AgentMemoryRepository(db,other).search('用户',{scope:'global'}),[]);
  assert.equal(new AgentMemoryRepository(db,other).delete(entry.id),false);
  memory.delete(entry.id);
  assert.equal((db.prepare('SELECT count(*) n FROM copilot_memory_search_index').get() as {n:number}).n,0);
  memory.create({scope:'global',kind:'fact',text:'用户私有记忆'});
  db.prepare('DELETE FROM users WHERE id=?').run(userId);
  assert.equal((db.prepare('SELECT count(*) n FROM copilot_memory_fts WHERE user_id=?').get(userId) as {n:number}).n,0);
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
});
it('continues a partially rebuilt file database after reopening',t=>{
  const directory=mkdtempSync(join(tmpdir(),'fb-memory-index-')),filename=join(directory,'fixture.db');
  let db=new Database(filename);db.pragma('foreign_keys=ON');
  t.after(()=>{if(db.open)db.close();rmSync(directory,{recursive:true,force:true});});
  migrate(drizzle(db),{migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url))});
  const userId=new UserRepository(db).create('reopen-index@example.invalid','hash').id;
  let memory=new AgentMemoryRepository(db,userId);let target='';
  for(let i=0;i<65;i++)target=memory.create({scope:'global',kind:'fact',text:`历史记录 item${i}`}).id;
  db.prepare('DELETE FROM copilot_memory_search_index WHERE user_id=?').run(userId);
  assert.throws(()=>memory.search('item64',{scope:'global'}),/INDEX_BUILDING/);
  db.close();db=new Database(filename);db.pragma('foreign_keys=ON');memory=new AgentMemoryRepository(db,userId);
  assert.equal(memory.search('item64',{scope:'global'})[0]!.id,target);
  assert.equal((db.prepare('SELECT count(*) n FROM copilot_memory_search_index WHERE user_id=?').get(userId) as {n:number}).n,65);
});
it('upgrades a populated pre-index database without changing original memory text',t=>{
  const directory=mkdtempSync(join(tmpdir(),'fb-memory-upgrade-')),legacy=join(directory,'migrations');
  t.after(()=>rmSync(directory,{recursive:true,force:true}));mkdirSync(join(legacy,'meta'),{recursive:true});
  const migrations=fileURLToPath(new URL('../src/db/migrations/',import.meta.url));
  const journal=JSON.parse(readFileSync(join(migrations,'meta/_journal.json'),'utf8')) as {entries:Array<{tag:string}>};
  journal.entries=journal.entries.filter(entry=>Number(entry.tag.slice(0,4))<=112);
  writeFileSync(join(legacy,'meta/_journal.json'),JSON.stringify(journal));
  for(const entry of journal.entries)copyFileSync(join(migrations,entry.tag+'.sql'),join(legacy,entry.tag+'.sql'));
  const db=new Database(join(directory,'old.db'));db.pragma('foreign_keys=ON');
  try {
    migrate(drizzle(db),{migrationsFolder:legacy});
    const userId=new UserRepository(db).create('old-index@example.invalid','hash').id;
    const text='用户偏好中文回答，工具为ＰＮＰＭ。';
    db.prepare("INSERT INTO copilot_memory(id,user_id,scope,kind,text,created_at,updated_at) VALUES('historical',?,'global','fact',?,1,1)").run(userId,text);
    db.prepare("INSERT INTO copilot_memory_fts(memory_id,user_id,scope,project_id,kind,text) VALUES('historical',?,'global','','fact',?)").run(userId,text);
    const original=db.prepare('SELECT * FROM copilot_memory').all();
    migrate(drizzle(db),{migrationsFolder:migrations});
    assert.deepEqual(db.prepare('SELECT * FROM copilot_memory').all(),original);
    const memory=new AgentMemoryRepository(db,userId);
    assert.equal(memory.search('用户 pnpm',{scope:'global'})[0]!.id,'historical');
    migrate(drizzle(db),{migrationsFolder:migrations});
    assert.deepEqual(db.prepare('SELECT * FROM copilot_memory').all(),original);
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
  }finally{db.close();}
});
it('isolates a failed background indexing batch from other users and runtime recovery',async t=>{
  const {db,userId,memory}=fixture(t),other=new UserRepository(db).create('good-index@example.invalid','hash').id;
  memory.create({scope:'global',kind:'fact',text:'原始记忆'});
  new AgentMemoryRepository(db,other).create({scope:'global',kind:'fact',text:'另外的用户记忆'});
  db.exec('DELETE FROM copilot_memory_search_index');
  db.exec("CREATE TRIGGER fail_one_tenant BEFORE INSERT ON copilot_memory_search_index WHEN NEW.user_id=(SELECT id FROM users WHERE email='search-quality@example.invalid') BEGIN SELECT RAISE(ABORT,'fixture tenant failure'); END;");
  const runtime=startCopilotRuntime({db,masterKey:'a'.repeat(64),eventBus:new ForgeBadgerEventBus()});
  try {
    await runtime.ready;
    assert.equal((db.prepare('SELECT count(*) n FROM copilot_memory_search_index WHERE user_id=?').get(userId) as {n:number}).n,0);
    assert.equal((db.prepare('SELECT count(*) n FROM copilot_memory_search_index WHERE user_id=?').get(other) as {n:number}).n,1);
  }finally{await runtime.stop();}
});
for(const multi of [false,true])it(`keeps readiness and ${multi?'all scopes':'explicit search'} on one snapshot during a peer write`,t=>{
  const directory=mkdtempSync(join(tmpdir(),'fb-memory-race-')),filename=join(directory,'fixture.db');
  let peer:Database.Database|undefined,userId='',armed=false,interleaved=false;
  const db=new Database(filename,{verbose(sql){
    if(armed&&!interleaved&&String(sql).includes('INNER JOIN copilot_memory_fts')){
      interleaved=true;peer!.prepare("UPDATE copilot_memory SET text='replacement content' WHERE user_id=?").run(userId);
    }
  }});
  db.pragma('journal_mode=WAL');
  t.after(()=>{peer?.close();db.close();rmSync(directory,{recursive:true,force:true});});
  migrate(drizzle(db),{migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url))});
  userId=new UserRepository(db).create('race-memory@example.invalid','hash').id;
  const memory=new AgentMemoryRepository(db,userId),project=new ProjectRepository(db,userId).create({name:'P',path:'/tmp/race-memory',aiTool:'codex'});
  memory.create({scope:'global',kind:'fact',text:'original needle'});
  memory.create({scope:'project',projectId:project.id,kind:'fact',text:'scoped needle'});
  peer=new Database(filename);peer.pragma('journal_mode=WAL');armed=true;
  const result=multi?memory.searchMulti([{scope:'global'},{scope:'project',projectId:project.id}],'needle'):memory.search('needle',{scope:'global'});
  assert.equal(interleaved,true);assert.equal(result.length,multi?2:1,'all results must share the readiness snapshot');
  assert.ok(result.every(row=>row.text.includes('needle')));
  assert.equal((db.prepare('SELECT count(*) n FROM copilot_memory_search_index WHERE user_id=?').get(userId) as {n:number}).n,0,'peer invalidation committed');
  assert.equal(memory.search('replacement',{scope:'global'}).length,1,'next search rebuilds changed source');
});
