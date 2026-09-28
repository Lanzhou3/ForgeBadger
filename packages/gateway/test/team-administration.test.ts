import {seedLegacyPolicy,seedLegacyReceipt} from './fixtures/legacy-delivery.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {UserRepository} from '../src/db/repositories/user-repository.js';
import {ProjectRepository} from '../src/db/repositories/project-repository.js';
import {CollaborationRepository} from '../src/db/repositories/collaboration-repository.js';

test('enrolled project stewardship is independent from storage owner and legacy paths cannot bypass it',()=>{
 const root=realpathSync(mkdtempSync(path.join(tmpdir(),'fb-teams-'))),db=new Database(':memory:');
 migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 try {
  const users=new UserRepository(db),original=users.create('original@team.test','hash'),successor=users.create('successor@team.test','hash'),admin=users.create('admin@team.test','hash');
  const project=new ProjectRepository(db,original.id).create({name:'Shared',path:root,aiTool:'codex'});
  db.prepare("INSERT INTO teams(id,user_id,owner_id,name,created_at,updated_at) VALUES('team',?,?,'Team',1,1)").run(admin.id,admin.id);
  for(const user of [original,successor,admin])db.prepare("INSERT INTO team_members(user_id,team_id,member_id,role) VALUES(?,'team',?,'admin')").run(admin.id,user.id);
  db.prepare("INSERT INTO team_projects(user_id,team_id,project_user_id,project_id,logical_owner_id) VALUES(?,'team',?,?,?)").run(admin.id,original.id,project.id,successor.id);
  db.prepare('INSERT INTO collaboration_projects(user_id,project_id,protected_root) VALUES(?,?,?)').run(original.id,project.id,root);
  users.update(original.id,{status:'disabled'});
  const access=new CollaborationRepository(db,successor.id).access(project.id,'manage');assert.equal(access.userId,original.id);assert.equal(access.actorId,successor.id);
  assert.equal(new ProjectRepository(db,original.id).getById(project.id),undefined);
  const authority=new CollaborationRepository(db,admin.id);assert.equal(authority.access(project.id,'manage').role,'admin');assert.throws(()=>authority.access(project.id,'develop'));
  assert.throws(()=>new ProjectRepository(db,admin.id).import({name:'alias',path:path.join(root,'nested'),aiTool:'codex'}));
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});

import {TeamRepository} from '../src/db/repositories/team-repository.js';
import {TeamInvitations} from '../src/services/teams/invitations.js';
import {TeamService} from '../src/services/teams/service.js';
import {DeliveryService} from '../src/services/collaboration/delivery-service.js';

test('email-bound invitation is single use and offboarding hands logical ownership over without moving storage',async()=>{
 const root=realpathSync(mkdtempSync(path.join(tmpdir(),'fb-team-flow-'))),db=new Database(':memory:');
 migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 try{
 const users=new UserRepository(db),owner=users.create('owner@test.dev','hash'),member=users.create('member@test.dev','hash'),next=users.create('next@test.dev','hash');
 const repo=new TeamRepository(db,owner.id),team=repo.create('Small team'),invites=new TeamInvitations(db);
 const invitation=invites.issue(owner.id,team.id,member.email,'member');
 assert.throws(()=>invites.accept(next.id,invitation.token),/EMAIL_MISMATCH/);invites.accept(member.id,invitation.token);assert.throws(()=>invites.accept(member.id,invitation.token),/INVITATION_INVALID/);
 invites.accept(next.id,invites.issue(owner.id,team.id,next.email,'member').token);
 const p=new ProjectRepository(db,member.id).create({name:'Work',path:root,aiTool:'codex'}),delivery=new DeliveryService({db,workspacesRoot:path.join(root,'workspaces')}),service=new TeamService(delivery);
 await service.enroll(member.id,team.id,p.id,0,repo.access(team.id).team.revision);
 const impact=service.impact(owner.id,team.id,member.id);assert.equal(impact.projects[0]?.requiresOwnerTransfer,true);
 const plan=service.plan(owner.id,team.id,member.id,impact.member.revision,[{projectId:p.id,newOwnerId:next.id,assigneeId:null,reviewerId:null}],impact.impactDigest);
 const result=await service.commit(owner.id,team.id,plan.plan.id,plan.confirmationToken);assert.equal(result.plan.state,'completed');
 assert.throws(()=>new CollaborationRepository(db,member.id).access(p.id));users.update(member.id,{status:'disabled'});
 assert.equal(new CollaborationRepository(db,next.id).access(p.id,'manage').userId,member.id);
 assert.equal((db.prepare('SELECT user_id FROM projects WHERE id=?').get(p.id) as {user_id:string}).user_id,member.id);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});

test('offboarding persists denial while stop is pending, then a replacement admin can resume after restart',async()=>{
 const root=realpathSync(mkdtempSync(path.join(tmpdir(),'fb-team-pending-'))),db=new Database(':memory:');migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 try{
 const users=new UserRepository(db),owner=users.create('owner@pending.test','hash'),member=users.create('member@pending.test','hash'),admin=users.create('admin@pending.test','hash');
 const r=new TeamRepository(db,owner.id),t=r.create('Pending'),invites=new TeamInvitations(db);for(const [u,role] of [[member,'member'],[admin,'admin']] as const)invites.accept(u.id,invites.issue(owner.id,t.id,u.email,role).token);
 const p=new ProjectRepository(db,member.id).create({name:'Pending',path:root,aiTool:'codex'}),delivery=new DeliveryService({db,workspacesRoot:path.join(root,'workspaces')}),s=new TeamService(delivery);await s.enroll(member.id,t.id,p.id,0,r.access(t.id).team.revision);
 const task=delivery.tasks(owner.id).create(p.id,{title:'handoff',acceptanceCriteria:['test'],assigneeId:member.id});
 const access=new CollaborationRepository(db,member.id).access(p.id),runId='pending-run';
 db.prepare("INSERT INTO delivery_runs(id,user_id,project_id,work_item_id,actor_id,idempotency_key,input_digest,adapter,membership_revision,authority_epoch,state,workspace_path,branch,created_at,updated_at) VALUES(?,?,?,?,?,'once','digest','codex',0,?,'ready',?,'branch',1,1)").run(runId,member.id,p.id,task.id,member.id,access.authorityEpoch,path.join(root,'workspace'));
 const impact=s.impact(owner.id,t.id,member.id),handoffs=[{projectId:p.id,newOwnerId:admin.id,assigneeId:admin.id,reviewerId:null}];
 assert.throws(()=>s.plan(owner.id,t.id,member.id,impact.member.revision,handoffs,'0'.repeat(64)),/PLAN_STALE/);
 const plan=s.plan(owner.id,t.id,member.id,impact.member.revision,handoffs,impact.impactDigest);
 delivery.stop=async()=>false;
 assert.equal((await s.commit(owner.id,t.id,plan.plan.id,plan.confirmationToken)).plan.state,'stopping');
 assert.throws(()=>new CollaborationRepository(db,member.id).access(p.id));assert.equal(s.plans(admin.id,t.id).plans[0]?.id,plan.plan.id);assert.equal(s.planStatus(member.id,t.id,plan.plan.id).plan.state,'stopping');
 assert.equal((db.prepare('SELECT logical_owner_id FROM team_projects WHERE project_id=?').get(p.id) as {logical_owner_id:string}).logical_owner_id,member.id);
 const restart=new TeamService(new DeliveryService({db,workspacesRoot:path.join(root,'workspaces')}));restart.delivery.stop=async()=>true;
 const completed=await restart.resume(admin.id,t.id,plan.plan.id);assert.equal(completed.plan.state,'completed');assert.equal(new CollaborationRepository(db,admin.id).access(p.id).logicalOwnerId,admin.id);
 assert.equal(delivery.tasks(admin.id).get(new CollaborationRepository(db,admin.id).access(p.id),task.id).assigneeId,admin.id);
 const event=db.prepare("SELECT actor_id FROM team_events WHERE kind='offboarding_completed'").get() as {actor_id:string};assert.equal(event.actor_id,owner.id);
 assert.deepEqual(db.pragma('foreign_key_check'),[]);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});

test('team admin never takes personal projects, escalates a member or uses ungranted developer authority',async()=>{
 const root=realpathSync(mkdtempSync(path.join(tmpdir(),'fb-team-roles-'))),db=new Database(':memory:');migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 try{
 const users=new UserRepository(db),owner=users.create('owner@roles.test','hash'),admin=users.create('admin@roles.test','hash'),member=users.create('member@roles.test','hash');const r=new TeamRepository(db,owner.id),t=r.create('Roles'),i=new TeamInvitations(db);
 i.accept(admin.id,i.issue(owner.id,t.id,admin.email,'admin').token);i.accept(member.id,i.issue(owner.id,t.id,member.email,'member').token);
 assert.throws(()=>i.issue(admin.id,t.id,'outsider@roles.test','admin'),/CAPABILITY_DENIED/);assert.throws(()=>new TeamRepository(db,admin.id).changeRole(t.id,member.id,'admin',1),/CAPABILITY_DENIED/);assert.throws(()=>users.update(owner.id,{status:'disabled'}),/OWNER_TRANSFER_REQUIRED/);
 const p=new ProjectRepository(db,member.id).create({name:'Private',path:root,aiTool:'codex'}),s=new TeamService(new DeliveryService({db,workspacesRoot:path.join(root,'workspaces')}));await assert.rejects(s.enroll(admin.id,t.id,p.id,0,r.access(t.id).team.revision));
 await s.enroll(member.id,t.id,p.id,0,r.access(t.id).team.revision);const a=new CollaborationRepository(db,admin.id).access(p.id);assert.deepEqual(a.capabilities,['read','manage']);assert.throws(()=>new CollaborationRepository(db,admin.id).access(p.id,'review'));
 const issued=i.issue(owner.id,t.id,'invited@roles.test','member');r.transfer(t.id,admin.id,r.access(t.id).team.revision);assert.throws(()=>i.valid(issued.token),/INVITATION_INVALID/);
 assert.throws(()=>r.close(t.id,r.access(t.id).team.revision),/CAPABILITY_DENIED/);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});

import {SessionRepository} from '../src/db/repositories/session-repository.js';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {DeliveryEvidence} from '../src/services/collaboration/delivery-evidence.js';

test('enrollment refuses an already running alias terminal before installing the protection',async()=>{
 const root=realpathSync(mkdtempSync(path.join(tmpdir(),'fb-team-alias-'))),db=new Database(':memory:');migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 try{mkdirSync(path.join(root,'nested'));const users=new UserRepository(db),owner=users.create('owner@alias.test','hash'),r=new TeamRepository(db,owner.id),team=r.create('Alias'),projects=new ProjectRepository(db,owner.id),p=projects.create({name:'source',path:root,aiTool:'codex'}),alias=projects.create({name:'alias',path:path.join(root,'nested'),aiTool:'codex'}),session=new SessionRepository(db,owner.id).create({projectId:alias.id,name:'alias terminal',aiTool:'codex',workingDir:root,credentialMode:'host_environment'}),s=new TeamService(new DeliveryService({db,workspacesRoot:path.join(root,'workspace')}));
 new SessionRepository(db,owner.id).update(session.id,{status:'running'});await assert.rejects(s.enroll(owner.id,team.id,p.id,0,1),/TEAM_PROJECT_EXECUTION_ACTIVE/);assert.equal(db.prepare('SELECT 1 FROM team_projects WHERE project_id=?').get(p.id),undefined);
 new SessionRepository(db,owner.id).update(session.id,{status:'stopped'});await s.enroll(owner.id,team.id,p.id,0,1);assert.equal(projects.getById(alias.id),undefined);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});

test('real team worktree survives storage-owner disable and revoked reviewer acceptance cannot revive',async()=>{
 const root=realpathSync(mkdtempSync(path.join(tmpdir(),'fb-team-git-'))),source=path.join(root,'source');mkdirSync(source);const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();git(source,'init','-b','main');git(source,'config','user.email','test@example.invalid');git(source,'config','user.name','Team fixture');writeFileSync(path.join(source,'check.cjs'),'process.exit(0)\n');git(source,'add','.');git(source,'commit','-m','initial');
 const db=new Database(':memory:');migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 try{const users=new UserRepository(db),owner=users.create('owner@git.test','hash'),storage=users.create('storage@git.test','hash'),reviewer=users.create('reviewer@git.test','hash');const r=new TeamRepository(db,owner.id),team=r.create('Git'),invitations=new TeamInvitations(db);for(const user of [storage,reviewer])invitations.accept(user.id,invitations.issue(owner.id,team.id,user.email,'member').token);
 const project=new ProjectRepository(db,storage.id).create({name:'Git',path:source,aiTool:'codex'}),delivery=new DeliveryService({db,workspacesRoot:path.join(root,'workspaces'),sessionManager:runtimeFixtureManager(db)}),s=new TeamService(delivery);await s.enroll(storage.id,team.id,project.id,0,r.access(team.id).team.revision);s.transferProject(owner.id,team.id,project.id,owner.id,1);users.update(storage.id,{status:'disabled'});
 const authority=new CollaborationRepository(db,owner.id);seedLegacyPolicy(db,delivery.authority(owner.id).access(project.id).userId,project.id,source);
 const task=delivery.tasks(owner.id).create(project.id,{title:'Real team delivery',acceptanceCriteria:['check passes'],assigneeId:owner.id}),run=await delivery.prepare(owner.id,project.id,task.id,{aiTool:'codex',idempotencyKey:randomUUID()}),full=delivery.context(owner.id,project.id,run.run.id).run;writeFileSync(path.join(full.workspace_path,'change.txt'),'a real change\n');git(full.workspace_path,'add','.');git(full.workspace_path,'commit','-m','team change');const commit=git(full.workspace_path,'rev-parse','HEAD'),v=new DeliveryEvidence(delivery),receipt=seedLegacyReceipt(delivery,owner.id,project.id,full.id,commit);assert.equal(receipt.receipt.status,'passed');
 await assert.rejects(v.review(owner.id,project.id,full.id,{expectedCommit:commit,verificationId:receipt.receipt.id,decision:'accepted',note:'Self review'}),/INDEPENDENT_REVIEWER_REQUIRED/);const repo=delivery.context(owner.id,project.id,full.id).repo;repo.review(full,owner.id,repo.getReceipt(full,receipt.receipt.id),'accepted','Historical self acceptance');await assert.rejects(v.integrate(owner.id,project.id,full.id,commit),/INDEPENDENT_REVIEWER_REQUIRED/);authority.putMember(project.id,reviewer.email,'reviewer');
 await v.review(reviewer.id,project.id,full.id,{expectedCommit:commit,verificationId:receipt.receipt.id,decision:'accepted',note:'Reviewed'});
 await delivery.revoke(owner.id,project.id,reviewer.id);authority.putMember(project.id,reviewer.email,'reviewer');await assert.rejects(v.integrate(owner.id,project.id,full.id,commit),/STALE_REVIEW_AUTHORITY/);
 await v.review(reviewer.id,project.id,full.id,{expectedCommit:commit,verificationId:receipt.receipt.id,decision:'accepted',note:'Reviewed again'});assert.equal((await v.integrate(owner.id,project.id,full.id,commit)).run.state,'integrated');assert.equal(git(source,'rev-parse','HEAD'),commit);
 new SessionRepository(db,owner.id).update(full.session_id!,{runtimeSessionName:'already-stopped-runtime',status:'stopped'});let unexpectedKill=0;
 const confirmations=new SessionRuntimeConfirmationRepository(db,owner.id),generation={runtimeName:'already-stopped-runtime',launchNonce:randomUUID(),daemon:fixtureDaemon};confirmations.begin(full.session_id!,generation);confirmations.confirm(full.session_id!,generation.launchNonce,{...generation,stopped:true});
 const stoppedManager=runtimeFixtureManager(db,{async confirmedStop(){unexpectedKill++;throw new Error('Already gone');}});
 assert.equal(await new DeliveryService({db,workspacesRoot:path.join(root,'workspaces'),sessionManager:stoppedManager}).stop(full),true);assert.equal(unexpectedKill,0);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});

test('missing source keeps handoff pending but still stops known PTY',async()=>{
 const root=realpathSync(mkdtempSync(path.join(tmpdir(),'fb-team-stop-'))),db=new Database(':memory:');migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 try{const u=new UserRepository(db).create('stop@missing.test','hash'),p=new ProjectRepository(db,u.id).create({name:'Missing source',path:root,aiTool:'codex'}),session=new SessionRepository(db,u.id).create({projectId:p.id,name:'Known CLI',aiTool:'codex',workingDir:root,runtimeSessionName:'known-runtime'});db.prepare('INSERT INTO collaboration_projects(user_id,project_id,protected_root) VALUES(?,?,?)').run(u.id,p.id,root);db.prepare('UPDATE projects SET path=? WHERE id=?').run(path.join(root,'missing'),p.id);
 let stopCalls=0;new SessionRuntimeConfirmationRepository(db,u.id).begin(session.id,{runtimeName:'known-runtime',launchNonce:randomUUID(),daemon:fixtureDaemon});const manager=runtimeFixtureManager(db,{async confirmedStop(g){stopCalls++;return {runtimeName:g.runtimeName,launchNonce:g.launchNonce,daemon:g.daemon,stopped:true};}});
 const delivery=new DeliveryService({db,workspacesRoot:root,sessionManager:manager});
 const run={id:'run',user_id:u.id,project_id:p.id,actor_id:u.id,session_id:session.id,workspace_path:path.join(root,'workspace')} as import('../src/services/collaboration/types.js').DeliveryRun;
 assert.equal(await delivery.stop(run),false);assert.equal(stopCalls,1);assert.equal((db.prepare('SELECT status FROM sessions WHERE id=?').get(session.id) as {status:string}).status,'stopped');
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});

test('enrollment rechecks alias sessions after the final asynchronous liveness lookup',async()=>{
 const root=realpathSync(mkdtempSync(path.join(tmpdir(),'fb-team-enroll-race-'))),db=new Database(':memory:');migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 try{mkdirSync(path.join(root,'nested'));const u=new UserRepository(db).create('race@enroll.test','hash'),r=new TeamRepository(db,u.id),team=r.create('Race'),p=new ProjectRepository(db,u.id).create({name:'Source',path:root,aiTool:'codex'}),alias=new ProjectRepository(db,u.id).create({name:'Alias',path:path.join(root,'nested'),aiTool:'codex'}),sessions=new SessionRepository(db,u.id),first=sessions.create({projectId:alias.id,name:'Alias',aiTool:'codex',workingDir:path.join(root,'nested')}),last=sessions.create({projectId:p.id,name:'Source',aiTool:'codex',workingDir:root});sessions.update(first.id,{status:'stopped'});sessions.update(last.id,{status:'stopped'});
 const confirmations=new SessionRuntimeConfirmationRepository(db,u.id);for(const session of [first,last])confirmations.begin(session.id,{runtimeName:session.id,launchNonce:randomUUID(),daemon:fixtureDaemon});
 const manager=runtimeFixtureManager(db,{async confirmedStopStatus(g){if(g.runtimeName===last.id)sessions.update(first.id,{status:'running'});return {runtimeName:g.runtimeName,launchNonce:g.launchNonce,daemon:g.daemon,stopped:true};}});
 const s=new TeamService(new DeliveryService({db,workspacesRoot:path.join(root,'workspaces'),sessionManager:manager}));await assert.rejects(s.enroll(u.id,team.id,p.id,0,1),/TEAM_PROJECT_EXECUTION_ACTIVE/);assert.equal(db.prepare('SELECT 1 FROM team_projects WHERE project_id=?').get(p.id),undefined);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});

test('offboarding confirmation is actor-bound and replacement failure can be repaired without restoring departing access',async()=>{
 const root=realpathSync(mkdtempSync(path.join(tmpdir(),'fb-team-repair-'))),db=new Database(':memory:');migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 try{const users=new UserRepository(db),owner=users.create('owner@repair.test','hash'),member=users.create('member@repair.test','hash'),next=users.create('next@repair.test','hash'),admin=users.create('admin@repair.test','hash'),r=new TeamRepository(db,owner.id),t=r.create('Repair'),invites=new TeamInvitations(db);for(const [u,role] of [[member,'member'],[next,'member'],[admin,'admin']] as const)invites.accept(u.id,invites.issue(owner.id,t.id,u.email,role).token);
 const p=new ProjectRepository(db,member.id).create({name:'Repair',path:root,aiTool:'codex'}),delivery=new DeliveryService({db,workspacesRoot:path.join(root,'workspaces')}),s=new TeamService(delivery);await s.enroll(member.id,t.id,p.id,0,r.access(t.id).team.revision);
 const task=delivery.tasks(owner.id).create(p.id,{title:'Repair task',acceptanceCriteria:['test'],assigneeId:member.id});db.prepare("INSERT INTO delivery_runs(id,user_id,project_id,work_item_id,actor_id,idempotency_key,input_digest,adapter,membership_revision,state,workspace_path,branch,created_at,updated_at) VALUES('repair-run',?,?,?,?,?,'digest','codex',0,'ready',?,'branch',1,1)").run(member.id,p.id,task.id,member.id,randomUUID(),path.join(root,'workspace'));
 const impact=s.impact(owner.id,t.id,member.id),plan=s.plan(owner.id,t.id,member.id,impact.member.revision,[{projectId:p.id,newOwnerId:next.id,assigneeId:next.id,reviewerId:null}],impact.impactDigest);
 await assert.rejects(s.commit(admin.id,t.id,plan.plan.id,plan.confirmationToken),/CONFIRMATION_ACTOR_MISMATCH/);assert.equal(s.rawPlan(t.id,plan.plan.id).state,'planned');
 delivery.stop=async()=>false;await s.commit(owner.id,t.id,plan.plan.id,plan.confirmationToken);users.update(next.id,{status:'disabled'});delivery.stop=async()=>true;
 const failed=await s.resume(admin.id,t.id,plan.plan.id);assert.equal(failed.plan.state,'stopping');assert.equal(failed.plan.error,'TEAM_HANDOFF_TARGET_CHANGED');assert.throws(()=>new CollaborationRepository(db,member.id).access(p.id));
 users.update(next.id,{status:'active'});const fresh=s.planStatus(admin.id,t.id,plan.plan.id);assert.ok(fresh.impact);const handoffs=[{projectId:p.id,newOwnerId:admin.id,assigneeId:admin.id,reviewerId:null}];assert.throws(()=>s.repair(admin.id,t.id,plan.plan.id,1,fresh.impact.impactDigest,handoffs),/PLAN_STALE/);
 let repaired=false;delivery.stop=async()=>{if(!repaired){s.repair(admin.id,t.id,plan.plan.id,fresh.plan.revision,fresh.impact!.impactDigest,handoffs);repaired=true;}return true;};const raced=await s.resume(admin.id,t.id,plan.plan.id);assert.equal(raced.plan.state,'stopping');assert.equal((db.prepare('SELECT logical_owner_id FROM team_projects WHERE project_id=?').get(p.id) as {logical_owner_id:string}).logical_owner_id,member.id);assert.equal((await s.resume(admin.id,t.id,plan.plan.id)).plan.state,'completed');assert.equal(new CollaborationRepository(db,admin.id).access(p.id).logicalOwnerId,admin.id);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});

test('interrupted real Git integration recovers through an active manager when logical steward is disabled',async()=>{
 const root=realpathSync(mkdtempSync(path.join(tmpdir(),'fb-team-reconcile-'))),source=path.join(root,'source');mkdirSync(source);const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();git(source,'init','-b','main');git(source,'config','user.email','test@example.invalid');git(source,'config','user.name','Recovery fixture');writeFileSync(path.join(source,'initial.txt'),'baseline');git(source,'add','.');git(source,'commit','-m','initial');const db=new Database(':memory:');migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 try{const users=new UserRepository(db),manager=users.create('manager@recovery.test','hash'),steward=users.create('steward@recovery.test','hash'),r=new TeamRepository(db,manager.id),t=r.create('Recovery'),invitations=new TeamInvitations(db);invitations.accept(steward.id,invitations.issue(manager.id,t.id,steward.email,'member').token);const project=new ProjectRepository(db,steward.id).create({name:'Recovery',path:source,aiTool:'codex'}),delivery=new DeliveryService({db,workspacesRoot:path.join(root,'workspaces'),sessionManager:runtimeFixtureManager(db)}),service=new TeamService(delivery);await service.enroll(steward.id,t.id,project.id,0,r.access(t.id).team.revision);
 const authority=new CollaborationRepository(db,manager.id);authority.putMember(project.id,manager.email,'developer');seedLegacyPolicy(db,steward.id,project.id,source);const task=delivery.tasks(manager.id).create(project.id,{title:'Reconcile',acceptanceCriteria:['merged'],assigneeId:manager.id}),prepared=await delivery.prepare(manager.id,project.id,task.id,{aiTool:'codex',idempotencyKey:randomUUID()}),run=delivery.context(manager.id,project.id,prepared.run.id).run;writeFileSync(path.join(run.workspace_path,'change.txt'),'change');git(run.workspace_path,'add','.');git(run.workspace_path,'commit','-m','implemented');const commit=git(run.workspace_path,'rev-parse','HEAD');
 users.update(steward.id,{status:'disabled'});assert.equal(authority.access(project.id,'manage').actorId,manager.id);git(source,'merge','--ff-only',commit);
 db.prepare("INSERT INTO delivery_operations(run_id,user_id,project_id,kind,phase,expected_commit,created_at) VALUES(?,?,?,'integrate','interrupted',?,?)").run(run.id,run.user_id,project.id,commit,Date.now());assert.throws(()=>users.update(steward.id,{status:'active'}),/DELIVERY_INTEGRATION_IN_PROGRESS/);
 await delivery.sweep();assert.equal(db.prepare('SELECT 1 FROM delivery_operations WHERE run_id=?').get(run.id),undefined);assert.equal(delivery.context(manager.id,project.id,run.id).run.state,'integrated');assert.equal(git(source,'rev-parse','HEAD'),commit);
 const event=db.prepare("SELECT actor_id,body_json FROM collaboration_events WHERE kind='integration_reconciled'").get() as {actor_id:string;body_json:string};assert.equal(event.actor_id,manager.id);assert.equal(JSON.parse(event.body_json).systemRecovery,true);assert.equal(JSON.parse(event.body_json).authorityActorId,manager.id);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});

import {InMemorySessionManager} from '../src/services/session-manager.js';
import {SessionRuntimeConfirmationRepository} from '../src/db/repositories/session-runtime-confirmation-repository.js';
import type {TerminalBackendClient} from '../src/services/terminal-backend.js';
test('enrollment final transaction rejects a newly pending runtime generation even when database status is error',async()=>{
 const root=realpathSync(mkdtempSync(path.join(tmpdir(),'fb-team-receipt-race-'))),db=new Database(':memory:');migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 try{
 const user=new UserRepository(db).create('receipt-race@team.test','hash'),teams=new TeamRepository(db,user.id),team=teams.create('Receipt race'),projects=new ProjectRepository(db,user.id),p=projects.create({name:'source',path:root,aiTool:'codex'});mkdirSync(path.join(root,'child'));const alias=projects.create({name:'alias',path:path.join(root,'child'),aiTool:'codex'}),sessions=new SessionRepository(db,user.id);
 const first=sessions.create({projectId:alias.id,name:'first',aiTool:'codex',workingDir:path.join(root,'child')}),last=sessions.create({projectId:p.id,name:'last',aiTool:'codex',workingDir:root});sessions.update(first.id,{status:'stopped'});sessions.update(last.id,{status:'stopped'});
 const confirmations=new SessionRuntimeConfirmationRepository(db,user.id),daemon={pid:12345,startedAt:new Date().toISOString()},a={runtimeName:'first-runtime',launchNonce:randomUUID(),daemon},b={runtimeName:'last-runtime',launchNonce:randomUUID(),daemon};confirmations.begin(first.id,a);confirmations.confirm(first.id,a.launchNonce,{...a,stopped:true});confirmations.begin(last.id,b);
 const manager=new InMemorySessionManager({async confirmedStopStatus(generation){confirmations.begin(first.id,{...a,launchNonce:randomUUID()});sessions.update(first.id,{status:'error'});return {runtimeName:generation.runtimeName,launchNonce:generation.launchNonce,daemon:generation.daemon,stopped:true};}} as TerminalBackendClient,undefined,undefined,{db});
 const service=new TeamService(new DeliveryService({db,workspacesRoot:path.join(root,'workspaces'),sessionManager:manager}));
 await assert.rejects(()=>service.enroll(user.id,team.id,p.id,0,1),/TEAM_PROJECT_EXECUTION_ACTIVE/);assert.equal(confirmations.get(first.id)?.status,'pending');assert.equal(db.prepare('SELECT 1 FROM team_projects WHERE project_id=?').get(p.id),undefined);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});

const fixtureDaemon={pid:12345,startedAt:'2026-09-20T00:00:00.000Z'};
function runtimeFixtureManager(db:Database.Database,overrides:Partial<TerminalBackendClient>={}) {
 const backend:TerminalBackendClient={supportsConfirmedSessionStop:()=>true,confirmedStopAuthority:async()=>fixtureDaemon,async createSession(){throw new Error('Fixture cannot launch terminals');},async killSession(){},async capturePane(){return '';},async listSessions(){return [];},async hasSession(){return false;},async confirmedStopStatus(){return null;},...overrides};
 return new InMemorySessionManager(backend,undefined,undefined,{db});
}
