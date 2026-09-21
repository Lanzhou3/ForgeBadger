import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {UserRepository} from '../src/db/repositories/user-repository.js';
import {ProjectRepository} from '../src/db/repositories/project-repository.js';
import {CollaborationRepository} from '../src/db/repositories/collaboration-repository.js';
import {CollaborationTasks} from '../src/services/collaboration/tasks.js';
import {TaskArtifactLinks} from '../src/services/project-manager/task-artifact-links.js';

function fixture(){
 const root=realpathSync(mkdtempSync(path.join(tmpdir(),'fb-task-artifacts-'))),db=new Database(path.join(root,'db.sqlite'));
 db.pragma('foreign_keys=ON');migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 const users=new UserRepository(db),owner=users.create('owner@artifact.test','hash'),viewer=users.create('viewer@artifact.test','hash'),outsider=users.create('other@artifact.test','hash');
 const project=new ProjectRepository(db,owner.id).create({name:'test',path:root,aiTool:'codex'}),authority=new CollaborationRepository(db,owner.id),tasks=new CollaborationTasks(db,owner.id);
 authority.putMember(project.id,viewer.email,'viewer');
 const task=tasks.create(project.id,{title:'Implementation',acceptanceCriteria:['works']}),artifactId=randomUUID(),intentId=randomUUID();
 const evidence=JSON.stringify({files:[{path:'private-name.cjs'}],checks:[{exitCode:0,timedOut:false,cancelled:false,stdout:'PRIVATE_OUTPUT',stderr:''}],diff:'PRIVATE_DIFF'}),digest=createHash('sha256').update(evidence).digest('hex');
 db.prepare(`INSERT INTO platform_action_intents(id,user_id,actor_user_id,authority,command_id,input_json,digest,resources_json,policy_version,expires_at,idempotency_key,status,created_at) VALUES(?,?,?,'owner_action','development.task.submit','{}',?,'{}',1,? ,?,'confirmed',?)`).run(intentId,owner.id,owner.id,digest,Date.now()+60000,randomUUID(),Date.now());
 db.prepare(`INSERT INTO copilot_development_tasks(id,user_id,project_id,goal,status,plan_json,recipe_digest,source_digest,output_digest,intent_id,project_root,evidence_json,artifact_digest,created_at,updated_at) VALUES(?,?,?,'PRIVATE_GOAL','checks_passed','{}',?,?,?,?,?,?,?,?,?)`).run(artifactId,owner.id,project.id,digest,digest,digest,intentId,root,evidence,digest,Date.now(),Date.now());
 const service=new TaskArtifactLinks(db,owner.id),input={developmentTaskId:artifactId,artifactDigest:digest,expectedTaskRevision:task.revision,shareSummary:true as const};
 return {db,root,owner,viewer,outsider,project,task,tasks,authority,artifactId,digest,service,input,close(){db.close();rmSync(root,{recursive:true,force:true});}};
}

test('explicit artifact link shares only a digest-bound summary and never completes or accepts a task',()=>{const f=fixture();try{
 const before=f.service.list(f.project.id,f.task.id);assert.equal(before.artifacts.length,0);assert.equal(before.candidates.length,1);
 const linked=f.service.link(f.project.id,f.task.id,f.input),again=f.service.link(f.project.id,f.task.id,f.input);assert.equal(again.id,linked.id);
 const view=new TaskArtifactLinks(f.db,f.viewer.id).list(f.project.id,f.task.id);assert.equal(view.candidates.length,0);assert.equal(view.artifacts.length,1);assert.equal(view.artifacts[0]!.canOpen,false);assert.equal(view.artifacts[0]!.passedChecks,1);
 assert.equal(view.artifacts[0]!.current,true);assert.ok(!JSON.stringify(view).includes('PRIVATE'));assert.ok(!JSON.stringify(view).includes('private-name'));assert.ok(!JSON.stringify(view).includes(f.root));
 assert.equal(f.tasks.get(f.authority.access(f.project.id),f.task.id).status,'todo');assert.equal((f.db.prepare('SELECT status FROM copilot_development_tasks WHERE id=?').get(f.artifactId) as {status:string}).status,'checks_passed');
 assert.equal(f.db.pragma('foreign_key_check').length,0);
}finally{f.close();}});

test('foreign actors, stale digests, missing explicit sharing and stale task revisions cannot link',()=>{const f=fixture();try{
 assert.throws(()=>new TaskArtifactLinks(f.db,f.outsider.id).list(f.project.id,f.task.id));
 assert.throws(()=>new TaskArtifactLinks(f.db,f.viewer.id).link(f.project.id,f.task.id,f.input));
 assert.throws(()=>f.service.link(f.project.id,f.task.id,{...f.input,artifactDigest:'0'.repeat(64)}));
 assert.throws(()=>f.service.link(f.project.id,f.task.id,{...f.input,shareSummary:false} as never));
 assert.throws(()=>f.service.link(f.project.id,f.task.id,{...f.input,expectedTaskRevision:99}));
 assert.equal(f.service.list(f.project.id,f.task.id).artifacts.length,0);
}finally{f.close();}});

test('changed task/evidence marks a retained artifact stale and revoked project reads fail',()=>{const f=fixture();try{
 f.service.link(f.project.id,f.task.id,f.input);f.tasks.update(f.project.id,f.task.id,{expectedRevision:f.task.revision,acceptanceCriteria:['changed']});
 assert.equal(f.service.list(f.project.id,f.task.id).artifacts[0]!.current,false);
 const changed=f.tasks.get(f.authority.access(f.project.id),f.task.id);
 assert.throws(()=>f.service.link(f.project.id,f.task.id,{...f.input,expectedTaskRevision:changed.revision}),/ARTIFACT_LINK_STALE/);
 f.db.prepare("UPDATE copilot_development_tasks SET evidence_json='{}' WHERE id=?").run(f.artifactId);
 assert.equal(f.service.list(f.project.id,f.task.id).candidates.length,0);
 f.authority.beginRevocation(f.project.id,f.viewer.id);
 assert.throws(()=>new TaskArtifactLinks(f.db,f.viewer.id).list(f.project.id,f.task.id));
}finally{f.close();}});

test('artifact association HTTP validates explicit sharing and preserves authenticated tenant isolation',async()=>{
 const {default:express}=await import('express'),{once}=await import('node:events');
 const {createTaskArtifactLinkRoutes}=await import('../src/routes/task-artifact-links.js'),{signJwt}=await import('../src/auth/jwt.js');
 const f=fixture(),app=express(),secret=randomUUID()+randomUUID();app.locals.jwtSecret=secret;app.use(express.json());app.use('/api/v1/collaboration',createTaskArtifactLinkRoutes(f.db));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');
 const endpoint=`http://127.0.0.1:${address.port}/api/v1/collaboration/projects/${f.project.id}/tasks/${f.task.id}/copilot-artifacts`;
 const request=(user:typeof f.owner,body?:unknown)=>fetch(endpoint,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${signJwt({userId:user.id,email:user.email},secret)}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal((await fetch(endpoint)).status,401);
  assert.equal((await request(f.owner,{...f.input,shareSummary:false})).status,400);
  assert.equal((await request(f.outsider,f.input)).status,404);
  assert.equal((await request(f.viewer,f.input)).status,403);
  assert.equal((await request(f.owner,f.input)).status,200);
  const visible=await request(f.viewer);assert.equal(visible.status,200);const body=await visible.json();assert.equal(body.data.artifacts.length,1);assert.equal(body.data.candidates.length,0);
  const reopen=new Database(path.join(f.root,'db.sqlite'));try{assert.equal(new TaskArtifactLinks(reopen,f.owner.id).list(f.project.id,f.task.id).artifacts.length,1);}finally{reopen.close();}
  f.authority.beginRevocation(f.project.id,f.viewer.id);assert.equal((await request(f.viewer)).status,404);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));f.close();}
});

test('database rejects task references crossing project or tenant boundaries',()=>{const f=fixture();try{
 const link=f.service.link(f.project.id,f.task.id,f.input);
 assert.throws(()=>f.db.prepare('UPDATE project_task_artifact_links SET user_id=? WHERE id=?').run(f.outsider.id,link.id),/FOREIGN KEY/);
 assert.throws(()=>f.db.prepare('DELETE FROM copilot_development_tasks WHERE id=?').run(f.artifactId),/FOREIGN KEY/);
 assert.equal(f.db.pragma('integrity_check',{simple:true}),'ok');
}finally{f.close();}});
