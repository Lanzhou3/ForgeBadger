import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import express from 'express';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {UserRepository} from '../src/db/repositories/user-repository.js';
import {ProjectRepository} from '../src/db/repositories/project-repository.js';
import {CollaborationRepository} from '../src/db/repositories/collaboration-repository.js';
import {CollaborationTasks} from '../src/services/collaboration/tasks.js';
import {ProjectManagerRepository} from '../src/db/repositories/project-manager-repository.js';
import {createProjectManagerRoutes} from '../src/routes/project-manager.js';
import {signJwt} from '../src/auth/jwt.js';
const secret='unified-task-fixture-jwt-secret-long-enough';
async function fixture(){
 const root=realpathSync(mkdtempSync(path.join(tmpdir(),'fb-unified-pm-'))),db=new Database(':memory:');migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 const users=new UserRepository(db),owner=users.create('owner@pm.test','hash'),developer=users.create('developer@pm.test','hash'),viewer=users.create('viewer@pm.test','hash');
 const project=new ProjectRepository(db,owner.id).create({name:'Shared',path:root,aiTool:'codex'}),authority=new CollaborationRepository(db,owner.id);authority.putMember(project.id,developer.email,'developer');authority.putMember(project.id,viewer.email,'viewer');
 const tasks=new CollaborationTasks(db,owner.id),task=tasks.create(project.id,{title:'Build',acceptanceCriteria:['passes']});
 const app=express();app.locals.db=db;app.locals.jwtSecret=secret;app.use(express.json());app.use('/api/v1/projects',createProjectManagerRoutes(db));const server=createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert(address&&typeof address==='object');
 const request=async(actor:string,url:string,method='GET',body?:unknown)=>{const r=await fetch(`http://127.0.0.1:${address.port}/api/v1/projects/${project.id}/project-manager${url}`,{method,headers:{Authorization:`Bearer ${signJwt({userId:actor,email:users.findById(actor)!.email},secret)}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json() as any};};
 return{root,db,owner,developer,viewer,project,tasks,task,authority,request,close:async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));db.close();rmSync(root,{recursive:true,force:true});}};
}
test('shared PM context is safe and task writes require current actor capability and revision',async()=>{const f=await fixture();try{
 const context=await f.request(f.viewer.id,'/context');assert.equal(context.status,200);assert.equal(context.body.data.privateDetailAllowed,false);assert.equal(JSON.stringify(context.body).includes(f.root),false);
 const list=await f.request(f.viewer.id,'/work-items');assert.equal(list.status,200);assert.equal(list.body.data.workItems[0].id,f.task.id);assert.equal(list.body.data.workItems[0].revision,1);
 assert.equal((await f.request(f.viewer.id,`/work-items/${f.task.id}`,'PATCH',{title:'bad',expectedRevision:1})).status,403);
 assert.equal((await f.request(f.developer.id,`/work-items/${f.task.id}`,'PATCH',{title:'missing'})).status,409);
 const result=await f.request(f.developer.id,`/work-items/${f.task.id}`,'PATCH',{title:'new',expectedRevision:1});assert.equal(result.status,200);assert.equal(result.body.data.workItem.revision,2);
 assert.equal((await f.request(f.developer.id,`/work-items/${f.task.id}`,'PATCH',{title:'stale',expectedRevision:1})).status,409);
 assert.equal((await f.request(f.owner.id,`/work-items/${f.task.id}/task-packet/start`,'POST',{})).status,409);
 assert.equal((await f.request(f.developer.id,'/goal','PUT',{summary:'not manager'})).status,403);
}finally{await f.close();}});
test('PM optimistic revision changes without invalidating semantic acceptance; manual completion is attributable',async()=>{const f=await fixture();try{
 const access=f.authority.access(f.project.id),digest=f.tasks.digest(access,f.task.id);
 let r=await f.request(f.developer.id,`/work-items/${f.task.id}`,'PATCH',{priority:80,expectedRevision:1});assert.equal(r.status,200);assert.equal(f.tasks.digest(access,f.task.id),digest);
 r=await f.request(f.developer.id,`/work-items/${f.task.id}/status`,'PATCH',{status:'in_progress',expectedRevision:2});assert.equal(r.status,200);
 r=await f.request(f.developer.id,`/work-items/${f.task.id}/status`,'PATCH',{status:'done',expectedRevision:3,manualCompletionReason:'Explicitly accepted by operator'});assert.equal(r.status,200);assert.equal(f.tasks.digest(access,f.task.id),digest);
 const stored=new ProjectManagerRepository(f.db,f.owner.id).getWorkItem(f.project.id,f.task.id)!;assert.deepEqual((stored.details.manualCompletion as any).reason,'Explicitly accepted by operator');assert.equal((stored.details.manualCompletion as any).actorId,f.developer.id);
 for(const kind of ['delivery',' delivery ','\tVERIFIED\n',' verification ','integrated'])assert.equal((await f.request(f.developer.id,`/work-items/${f.task.id}/evidence`,'POST',{expectedRevision:4,evidenceRefs:[{kind,status:'passed',ref:'fake'}]})).status,400);
 assert.equal((await f.request(f.owner.id,'/starter-packs/any/task-packet','POST',{})).status,409);
}finally{await f.close();}});
test('shared batch CAS rolls back all items, metadata does not leak private references, and revocation denies all old PM APIs',async()=>{const f=await fixture();try{
 const other=f.tasks.create(f.project.id,{title:'Other',acceptanceCriteria:[]}),repo=new ProjectManagerRepository(f.db,f.owner.id);
 repo.attachEvidence(f.project.id,f.task.id,{evidenceRefs:[{kind:'note',path:'/private/source/key.txt',ref:'/private/source',sessionId:'private-session',feishuChatId:'secret-chat'}]});
 const list=await f.request(f.viewer.id,'/work-items');assert.equal(JSON.stringify(list.body).includes('/private/source'),false);assert.equal(JSON.stringify(list.body).includes('private-session'),false);assert.equal(JSON.stringify(list.body).includes('secret-chat'),false);
 const batch=await f.request(f.developer.id,'/work-items/batch/status','POST',{updates:[{workItemId:f.task.id,status:'in_progress',expectedRevision:2},{workItemId:other.id,status:'in_progress',expectedRevision:9}]});assert.equal(batch.status,409);assert.equal(repo.getWorkItem(f.project.id,f.task.id)?.status,'todo');assert.equal(repo.taskMetadata(f.project.id,f.task.id).revision,2);
 const create=await f.request(f.developer.id,'/work-items','POST',{title:'Assigned',assigneeId:f.developer.id,reviewerId:f.owner.id});assert.equal(create.status,201);assert.equal(create.body.data.workItem.assigneeId,f.developer.id);
 assert.equal((await f.request(f.viewer.id,'/stages','POST',{name:'bad'})).status,403);
 assert.equal((await f.request(f.developer.id,'/stages','POST',{name:'bad'})).status,403);
 assert.equal((await f.request(f.owner.id,'/stages','POST',{name:'Build'})).status,201);
 assert.equal((await f.request(f.developer.id,`/work-items/${f.task.id}/dependencies`,'POST',{blockerWorkItemId:other.id,expectedRevision:2})).status,403);
 assert.equal((await f.request(f.owner.id,`/work-items/${f.task.id}/dependencies`,'POST',{blockerWorkItemId:other.id,expectedRevision:2})).status,201);
 assert.equal((await f.request(f.owner.id,`/work-items/${f.task.id}/dependencies/${other.id}`,'DELETE',{expectedRevision:2})).status,409);
 assert.equal((await f.request(f.owner.id,`/work-items/${f.task.id}/dependencies/${other.id}`,'DELETE',{expectedRevision:3})).status,200);
 f.authority.beginRevocation(f.project.id,f.developer.id);
 for(const url of ['/context','/goal','/stages','/work-items','/work-item-links','/ledger'])assert.equal((await f.request(f.developer.id,url)).status,404);
}finally{await f.close();}});
test('metadata-only assignment changes increments shared revision and invalidates semantic digest',async()=>{const f=await fixture();try{
 const access=f.authority.access(f.project.id),digest=f.tasks.digest(access,f.task.id);
 const response=await f.request(f.owner.id,`/work-items/${f.task.id}`,'PATCH',{assigneeId:f.developer.id,expectedRevision:1});assert.equal(response.status,200);assert.equal(response.body.data.workItem.revision,2);assert.notEqual(f.tasks.digest(access,f.task.id),digest);
 const current=f.tasks.update(f.project.id,f.task.id,{expectedRevision:2,reviewerId:f.owner.id});assert.equal(current.revision,3);
 assert.equal((await f.request(f.owner.id,`/work-items/${f.task.id}`,'PATCH',{title:'outdated',expectedRevision:2})).status,409);
 assert.equal((await f.request(f.owner.id,`/work-items/${f.task.id}/task-packet/session-link`,'POST',{sessionId:'any'})).status,409);
}finally{await f.close();}});
test('A to B to A task semantics never resurrect an old acceptance digest while status progress preserves it',async()=>{const f=await fixture();try{
 const access=f.authority.access(f.project.id),initial=f.tasks.digest(access,f.task.id);
 const first=await f.request(f.owner.id,`/work-items/${f.task.id}`,'PATCH',{title:'Changed',expectedRevision:1});assert.equal(first.status,200);assert.equal(first.body.data.workItem.semanticRevision,2);
 const second=await f.request(f.owner.id,`/work-items/${f.task.id}`,'PATCH',{title:'Build',expectedRevision:2});assert.equal(second.status,200);assert.equal(second.body.data.workItem.semanticRevision,3);assert.notEqual(f.tasks.digest(access,f.task.id),initial);
 const fresh=f.tasks.digest(access,f.task.id);f.tasks.progress(access,f.task.id,'in_progress');f.tasks.progress(access,f.task.id,'ready_for_review');assert.equal(f.tasks.digest(access,f.task.id),fresh);
 const current=f.tasks.get(access,f.task.id);assert.equal(current.revision,5);assert.equal(current.semanticRevision,3);
}finally{await f.close();}});
test('team administrators can manage enrolled PM after storage owner disable without gaining private project access',async()=>{const f=await fixture();try{
 f.db.prepare("INSERT INTO teams(id,user_id,owner_id,name,created_at,updated_at) VALUES('pm-team',?,?,'PM team',1,1)").run(f.viewer.id,f.viewer.id);
 for(const u of [f.owner,f.developer,f.viewer])f.db.prepare("INSERT INTO team_members(user_id,team_id,member_id,role) VALUES(?,'pm-team',?,'member')").run(f.viewer.id,u.id);
 f.db.prepare("INSERT INTO team_projects(user_id,team_id,project_user_id,project_id,logical_owner_id) VALUES(?,'pm-team',?,?,?)").run(f.viewer.id,f.owner.id,f.project.id,f.developer.id);
 new UserRepository(f.db).update(f.owner.id,{status:'disabled'});
 assert.equal(new ProjectRepository(f.db,f.viewer.id).getById(f.project.id),undefined);
 const context=await f.request(f.viewer.id,'/context');assert.equal(context.status,200);assert.equal(context.body.data.privateDetailAllowed,false);assert(context.body.data.access.capabilities.includes('manage'));assert(!context.body.data.access.capabilities.includes('develop'));
 const result=await f.request(f.viewer.id,`/work-items/${f.task.id}`,'PATCH',{title:'Admin plan',expectedRevision:1});assert.equal(result.status,200);
 const audit=f.db.prepare("SELECT details FROM audit_logs WHERE action='project_manager.work_item.update' ORDER BY rowid DESC LIMIT 1").get() as {details:string}|undefined;
 assert(audit);assert.equal(JSON.parse(audit.details).actorId,f.viewer.id);
 assert.equal((await f.request(f.viewer.id,`/work-items/${f.task.id}/task-packet/start`,'POST',{})).status,409);
}finally{await f.close();}});

import {PlatformActions} from '../src/services/platform-commands/actions.js';
import {createPlatformCommands} from '../src/services/platform-commands/catalog.js';
import {randomUUID} from 'node:crypto';
test('personal platform command cannot seed forged delivery evidence before a project is shared',async()=>{const f=await fixture();try{
 f.db.prepare("UPDATE collaboration_members SET state='revoked' WHERE project_id=?").run(f.project.id);
 const actions=new PlatformActions({db:f.db,userId:f.owner.id},createPlatformCommands());
 for(const kind of ['delivery',' delivery ','verified'])await assert.rejects(()=>actions.executeOwner('pm.work_item.create_with_evidence',{projectId:f.project.id,title:'forged',evidenceRefs:[{kind,label:'Verified and accepted delivery',status:'passed',ref:'fake'}]},randomUUID()));
 assert.equal(new ProjectManagerRepository(f.db,f.owner.id).listWorkItems(f.project.id).length,1);
}finally{await f.close();}});
test('personal unified PM payload retains governed receipts, revision CAS and assignment fields',async()=>{const f=await fixture();try{
 f.db.prepare("UPDATE collaboration_members SET state='revoked' WHERE project_id=?").run(f.project.id);
 const created=await f.request(f.owner.id,'/work-items','POST',{title:'Personal new UI',acceptanceCriteria:['works'],assigneeId:null,reviewerId:null});assert.equal(created.status,201);const item=created.body.data.workItem;assert.equal(item.revision,1);assert.equal(item.assigneeId,null);
 const edited=await f.request(f.owner.id,`/work-items/${item.id}`,'PATCH',{title:'Personal edited',description:null,priority:5,acceptanceCriteria:['works'],stageId:null,expectedRevision:1,assigneeId:f.owner.id,reviewerId:null});assert.equal(edited.status,200);assert.equal(edited.body.data.workItem.revision,2);assert.equal(edited.body.data.workItem.assigneeId,f.owner.id);
 assert.equal((await f.request(f.owner.id,`/work-items/${item.id}`,'PATCH',{title:'Stale',expectedRevision:1,assigneeId:null,reviewerId:null})).status,409);
 const cleared=await f.request(f.owner.id,`/work-items/${item.id}`,'PATCH',{title:'Personal edited',expectedRevision:2,assigneeId:null,reviewerId:null});assert.equal(cleared.status,200);assert.equal(cleared.body.data.workItem.assigneeId,null);assert.equal(cleared.body.data.workItem.revision,3);
 const receipts=f.db.prepare("SELECT command_id FROM platform_action_intents WHERE user_id=? ORDER BY rowid").all(f.owner.id) as Array<{command_id:string}>;
 assert(receipts.some(r=>r.command_id==='pm.work_item.create_with_evidence'));assert(receipts.some(r=>r.command_id==='pm.work_item.update'));
}finally{await f.close();}});
