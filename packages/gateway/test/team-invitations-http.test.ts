import assert from 'node:assert/strict';
import {test} from 'node:test';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import express from 'express';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {createAuthRouter,type RegistrationMode} from '../src/routes/auth.js';
import {createTeamRoutes} from '../src/routes/teams.js';
import {DeliveryService} from '../src/services/collaboration/delivery-service.js';
import {UserRepository} from '../src/db/repositories/user-repository.js';
import {TeamRepository} from '../src/db/repositories/team-repository.js';
import {TeamInvitations} from '../src/services/teams/invitations.js';
import {signJwt} from '../src/auth/jwt.js';

async function fixture(mode:RegistrationMode='invite'){
 const db=new Database(':memory:');migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 const users=new UserRepository(db),owner=users.create('owner@invite.test','hash',{role:'admin'}),repo=new TeamRepository(db,owner.id),team=repo.create('HTTP Team'),invites=new TeamInvitations(db),secret=randomBytes(32).toString('hex');
 const app=express();app.locals.db=db;app.locals.jwtSecret=secret;app.use(express.json());app.use('/auth',createAuthRouter(users,secret,{db,registrationMode:mode,accountRecovery:{isValid:()=>false} as never}));app.use('/teams',createTeamRoutes(new DeliveryService({db,workspacesRoot:'/unused-test-workspaces'})));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}`;
 async function request(route:string,body:unknown,token?:string){const res=await fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','x-forwarded-for':'192.0.2.1',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});return {status:res.status,body:await res.json() as {code:number;message:string;data:Record<string,unknown>}};}
 return {db,users,owner,team,invites,request,ownerToken:signJwt({userId:owner.id,email:owner.email},secret),close:async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));db.close();}};
}
test('remote invite registration consumes once atomically and never grants system admin',async()=>{const f=await fixture();try{
 const issued=f.invites.issue(f.owner.id,f.team.id,'new@invite.test','admin');
 const preview=await f.request('/auth/team-invitations/inspect',{token:issued.token});assert.equal(preview.status,200);assert.ok(!JSON.stringify(preview.body).includes(issued.token));
 const body={token:issued.token,email:'new@invite.test',password:'valid-fixture-password'};
 const results=await Promise.all([f.request('/auth/team-invitations/register',body),f.request('/auth/team-invitations/register',body)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,404]);
 assert.equal(f.users.count(),2);assert.equal(f.users.findByEmail(body.email)?.role,'user');assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM team_members WHERE team_id=?").get(f.team.id) as {n:number}).n,2);
 assert.equal((await f.request('/auth/register',{email:'ordinary@invite.test',password:'valid-fixture-password',recoveryKey:'wrong'})).status,403);
 assert.equal((await f.request('/auth/team-invitations/register',body)).status,404);
 assert.ok(!JSON.stringify(f.invites.list(f.owner.id,f.team.id)).includes(issued.token));assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
 }finally{await f.close();}});

test('off registration rejects new account but email-bound existing account can accept',async()=>{const f=await fixture('off');try{
 const user=f.users.create('existing@invite.test','hash'),invite=f.invites.issue(f.owner.id,f.team.id,user.email,'member');
 assert.equal((await f.request('/auth/team-invitations/register',{token:invite.token,email:user.email,password:'valid-fixture-password'})).status,403);
 assert.equal(f.invites.valid(invite.token).invitation.state,'pending');f.invites.accept(user.id,invite.token);
 const rejected=f.invites.issue(f.owner.id,f.team.id,'mismatch@invite.test','member');assert.throws(()=>f.invites.register(rejected.token,'other@invite.test','hash'),/EMAIL_MISMATCH/);assert.equal(f.users.findByEmail('other@invite.test'),undefined);
 }finally{await f.close();}});

test('revoked and expired invitation never create dangling users, and stale issuer authority invalidates it',async()=>{const f=await fixture();try{
 const revoked=f.invites.issue(f.owner.id,f.team.id,'revoked@invite.test','member');f.invites.revoke(f.owner.id,f.team.id,revoked.invitation.id);
 assert.equal((await f.request('/auth/team-invitations/register',{token:revoked.token,email:'revoked@invite.test',password:'fixture-password'})).status,404);assert.equal(f.users.count(),1);
 const expired=f.invites.issue(f.owner.id,f.team.id,'expired@invite.test','member');f.db.prepare('UPDATE team_invitations SET expires_at=0 WHERE id=?').run(expired.invitation.id);assert.throws(()=>f.invites.valid(expired.token),/INVITATION_INVALID/);
 }finally{await f.close();}});

test('disabling and re-enabling an invitation issuer cannot revive their outstanding invitations',async()=>{const f=await fixture();try{
 const admin=f.users.create('issuer@invite.test','hash'),join=f.invites.issue(f.owner.id,f.team.id,admin.email,'admin');f.invites.accept(admin.id,join.token);
 const pending=f.invites.issue(admin.id,f.team.id,'recipient@invite.test','member');f.users.update(admin.id,{status:'disabled'});f.users.update(admin.id,{status:'active'});
 assert.throws(()=>f.invites.valid(pending.token),/INVITATION_INVALID/);assert.equal(f.invites.list(f.owner.id,f.team.id).find(i=>i.id===pending.invitation.id)?.state,'revoked');
 }finally{await f.close();}});
