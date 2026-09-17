import assert from 'node:assert/strict';
import { once } from 'node:events';
import { it } from 'node:test';
import express from 'express';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createCopilotRoutes } from '../src/routes/copilot.js';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { signJwt } from '../src/auth/jwt.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';

it('reports unavailable dispatch separately and refuses enabling retired tools', async () => {
  const db = new Database(':memory:');
  migrate(drizzle(db),{migrationsFolder:new URL('../src/db/migrations/',import.meta.url).pathname});
  const user = new UserRepository(db).create('capability@test.dev','hash');
  const jwtSecret = 'fixture-secret-'.repeat(3);
  const app = express();app.use(express.json());app.locals.db=db;app.locals.jwtSecret=jwtSecret;
  app.use('/api/v1/copilot',createCopilotRoutes({db,masterKey:'test',eventBus:new ForgeBadgerEventBus()}));
  const server = app.listen(0,'127.0.0.1');
  await once(server,'listening');
  const address = server.address();assert.ok(address && typeof address!=='string');
  const base = `http://127.0.0.1:${address.port}/api/v1/copilot`;
  const headers = {Authorization:`Bearer ${signJwt({userId:user.id,email:user.email},jwtSecret)}`,'Content-Type':'application/json'};
  try {
    const response = await fetch(base+'/capabilities',{headers});
    assert.equal(response.status,200);
    const body = await response.json() as {data:{tools:Array<{name:string;available:boolean;effectiveEnabled:boolean;unavailableReason:string|null;authorization:string}>}};
    const dispatch = body.data.tools.find(tool=>tool.name==='dispatch_task_to_session')!;
    assert.equal(dispatch.available,false);assert.equal(dispatch.effectiveEnabled,false);
    assert.equal(dispatch.unavailableReason,'ADAPTER_AUTONOMY_UNVERIFIED');
    assert.equal(dispatch.authorization,'unavailable');
    assert.ok(body.data.tools.some(tool=>tool.name==='pm_prepare_task_packet'));
    const output = body.data.tools.find(tool=>tool.name==='get_session_output')!;
    assert.equal(output.unavailableReason,'SESSION_RUNTIME_UNAVAILABLE');
    for (const name of ['pm_start_task_packet','dispatch_task_to_session','list_skills','load_skill']) {
      assert.equal((await fetch(base+`/capabilities/${name}/enabled`,{method:'PUT',headers,body:JSON.stringify({enabled:true})})).status,404);
    }
    assert.equal((await fetch(base+'/capabilities/list_playbooks/enabled',{method:'PUT',headers,body:JSON.stringify({enabled:false})})).status,200);
  } finally {server.close();await once(server,'close');db.close();}
});
