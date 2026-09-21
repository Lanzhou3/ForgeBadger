import type {Database} from '../types.js';
import {CollaborationError,type Capability,type CollaborationRole} from '../../services/collaboration/types.js';
import type {TeamAccess,TeamRole,TeamRow} from '../../services/teams/types.js';

export function hasTeams(db:Database):boolean {return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='teams'").get();}
export function actorGeneration(db:Database,actorId:string):number {
 if(!hasTeams(db))return 0;
 return (db.prepare('SELECT epoch FROM user_authority_epochs WHERE user_id=?').get(actorId) as {epoch:number}|undefined)?.epoch??0;
}
export function teamAccess(db:Database,actorId:string,teamId:string,manage=false,allowClosed=false):TeamAccess {
 const row=db.prepare(`SELECT t.*,m.role AS member_role,m.revision AS member_revision FROM teams t
 JOIN team_members m ON m.team_id=t.id AND m.user_id=t.user_id AND m.member_id=? AND m.state='active'
 JOIN users u ON u.id=m.member_id AND u.status='active' WHERE t.id=?`).get(actorId,teamId) as (TeamRow&{member_role:'admin'|'member';member_revision:number})|undefined;
 if(!row||(!allowClosed&&row.state!=='active'))throw new CollaborationError(404,'TEAM_NOT_FOUND');
 const role:TeamRole=row.owner_id===actorId?'owner':row.member_role;
 if(manage&&role==='member')throw new CollaborationError(403,'TEAM_CAPABILITY_DENIED');
 return {team:row,actorId,role,membershipRevision:row.member_revision};
}
export interface TeamProjectAuthority {teamId:string;logicalOwnerId:string;projectRevision:number;role:CollaborationRole;membershipRevision:number;authorityEpoch:string;capabilities:Capability[]}
export function teamProjectAuthority(db:Database,actorId:string,projectId:string):TeamProjectAuthority|undefined {
 if(!hasTeams(db))return undefined;
 const project=db.prepare('SELECT team_id,logical_owner_id,revision FROM team_projects WHERE project_id=?').get(projectId) as {team_id:string;logical_owner_id:string;revision:number}|undefined;
 if(!project)return undefined;
 const access=teamAccess(db,actorId,project.team_id);
 const grant=db.prepare("SELECT role,revision FROM collaboration_members WHERE project_id=? AND member_id=? AND state='active'").get(projectId,actorId) as {role:'developer'|'reviewer'|'viewer';revision:number}|undefined;
 const owner=project.logical_owner_id===actorId,manager=owner||access.role!=='member';
 if(!manager&&!grant)throw new CollaborationError(404,'PROJECT_NOT_FOUND');
 const capabilities:Capability[]=['read'];
 if(owner||grant?.role==='developer'||grant?.role==='reviewer')capabilities.push('comment');
 if(owner||grant?.role==='developer')capabilities.push('develop');
 if(owner||grant?.role==='reviewer')capabilities.push('review');
 if(manager)capabilities.push('manage');
 return {teamId:project.team_id,logicalOwnerId:project.logical_owner_id,projectRevision:project.revision,role:owner?'owner':grant?.role??'admin',membershipRevision:grant?.revision??0,
 authorityEpoch:JSON.stringify([project.team_id,access.membershipRevision,grant?.revision??0,project.revision,actorGeneration(db,actorId)]),capabilities};
}
export function isEnrolled(db:Database,projectId:string):boolean {return hasTeams(db)&&!!db.prepare('SELECT 1 FROM team_projects WHERE project_id=?').get(projectId);}
