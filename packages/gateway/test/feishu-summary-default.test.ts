import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import Sqlite from 'better-sqlite3';

it('upgrades old subscriptions to built-in summaries without enabling, redirecting or replaying deliveries', () => {
  const db = new Sqlite(':memory:');
  try {
    db.exec("CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('group-owner'),('disabled-owner'),('unchanged-owner')");
    for (const tag of ['0119_feishu_notifications', '0120_feishu_notification_targets', '0127_cli_observation_summaries'])
      db.exec(readFileSync(new URL(`../src/db/migrations/${tag}.sql`, import.meta.url), 'utf8'));
    const insert = db.prepare(`INSERT INTO feishu_notification_settings
      (user_id,enabled,identity_id,target_id,types_json,web_base_url,revision,updated_at,content_level)
      VALUES(?,?,?,?,?,'https://forge.example',4,0,?)`);
    insert.run('group-owner',1,null,'group:existing','["failure","completion"]','status');
    insert.run('disabled-owner',0,'identity','private:identity','["completion"]','status');
    insert.run('unchanged-owner',1,'other','private:other','["failure"]','summary');
    const delivery = db.prepare(`INSERT INTO feishu_notification_deliveries
      (id,user_id,notification_id,event_type,subscription_revision,identity_revision,status,expires_at,created_at)
      VALUES(?,?,?,'completion',4,1,?,100,0)`);
    for(const user of ['group-owner','disabled-owner','unchanged-owner'])
      for(const status of ['pending','sending','delivered','failed','unknown'])
        delivery.run(`${user}-${status}`,user,`${user}-${status}`,status);
    const migration = readFileSync(new URL('../src/db/migrations/0128_feishu_builtin_summaries.sql', import.meta.url),'utf8');
    db.exec(migration);
    const rows = db.prepare('SELECT * FROM feishu_notification_settings ORDER BY user_id').all() as Array<Record<string,unknown>>;
    for(const row of rows) {
      assert.equal(row.content_level,'summary');
      assert.equal(row.revision,row.user_id==='unchanged-owner'?4:5);
      assert.equal(row.web_base_url,'https://forge.example');
    }
    const group=rows.find(row=>row.user_id==='group-owner')!;
    assert.equal(group.enabled,1);assert.equal(group.target_id,'group:existing');assert.equal(group.identity_id,null);
    assert.equal(group.types_json,'["failure","completion"]');
    const disabled=rows.find(row=>row.user_id==='disabled-owner')!;
    assert.equal(disabled.enabled,0);assert.equal(disabled.target_id,'private:identity');assert.equal(disabled.identity_id,'identity');
    for(const user of ['group-owner','disabled-owner','unchanged-owner']) {
      const read=(status:string)=>db.prepare('SELECT status,error_code FROM feishu_notification_deliveries WHERE id=?').get(`${user}-${status}`) as {status:string;error_code:string|null};
      assert.equal(read('pending').status,user==='unchanged-owner'?'pending':'cancelled');
      if(user!=='unchanged-owner')assert.equal(read('pending').error_code,'SUBSCRIPTION_CHANGED');
      for(const status of ['sending','delivered','failed','unknown'])assert.deepEqual(read(status),{status,error_code:null});
    }
    assert.equal((db.prepare('SELECT count(*) n FROM feishu_notification_deliveries').get() as {n:number}).n,15);
    assert.equal((db.prepare('SELECT count(*) n FROM feishu_notification_groups').get() as {n:number}).n,0);
    db.exec(migration);
    assert.deepEqual(db.prepare('SELECT * FROM feishu_notification_settings ORDER BY user_id').all(),rows);
  } finally { db.close(); }
});
