import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

it('renames persisted runtime identifiers without losing data and migrates only once', () => {
  const migrationsFolder = fileURLToPath(new URL('../src/db/migrations', import.meta.url));
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
  const target = journal.entries.find((entry: {tag: string}) => entry.tag === '0076_session_runtime_names');
  assert.ok(target, 'forward naming migration must exist');
  const dir = mkdtempSync(join(tmpdir(), 'fb-runtime-names-'));
  const db = new Database(':memory:');
  try {
    mkdirSync(join(dir, 'meta'));
    const predecessors = journal.entries.filter((entry: {idx: number}) => entry.idx < target.idx);
    writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({...journal, entries: predecessors}));
    for (const entry of predecessors) copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
    migrate(drizzle(db), {migrationsFolder: dir});
    db.prepare("INSERT INTO users(id,username,email,password_hash,role,status) VALUES('naming-user','naming-user','naming@example.test','x','user','active')").run();
    db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES('naming-project','naming-user','Naming','/tmp/naming','codex','active')").run();
    db.prepare("INSERT INTO sessions(id,user_id,project_id,name,ai_tool,status,working_dir,tmux_session) VALUES('naming-session','naming-user','naming-project','Naming','codex','running','/tmp/naming','fb-existing-runtime')").run();
    db.prepare("INSERT INTO session_snapshots(id,user_id,session_id,project_id,tmux_session) VALUES('naming-snapshot','naming-user','naming-session','naming-project','fb-existing-runtime')").run();
    const before = ['sessions','session_snapshots'].map(table => db.prepare(`SELECT * FROM ${table}`).all());
    migrate(drizzle(db), {migrationsFolder});
    for (const [index, table] of ['sessions','session_snapshots'].entries()) {
      const expected = (before[index] as Record<string, unknown>[]).map(({tmux_session, ...row}) => ({...row, runtime_session_name: tmux_session}));
      assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), expected);
      assert.ok(!(db.pragma(`table_info(${table})`) as {name:string}[]).some(column => column.name === 'tmux_session'));
    }
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    const applied = db.prepare('SELECT * FROM __drizzle_migrations').all();
    migrate(drizzle(db), {migrationsFolder});
    assert.deepEqual(db.prepare('SELECT * FROM __drizzle_migrations').all(), applied);
  } finally { db.close(); rmSync(dir, {recursive:true,force:true}); }
});
