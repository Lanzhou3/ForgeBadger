import type {Database} from '../../db/types.js';
import {CollaborationRepository} from '../../db/repositories/collaboration-repository.js';
import {ProjectRepository,type Project} from '../../db/repositories/project-repository.js';
import {CollaborationError,type Capability,type CollaborationAccess} from '../collaboration/types.js';

export function governedProject(db:Database,projectId:string):boolean {
 return Boolean(db.prepare("SELECT 1 FROM collaboration_members WHERE project_id=? AND state!='revoked' UNION ALL SELECT 1 FROM team_projects WHERE project_id=?").get(projectId,projectId));
}
export function projectManagerAccess(db:Database,actorId:string,projectId:string) {
 const personal=new ProjectRepository(db,actorId).getById(projectId);
 const governed=governedProject(db,projectId);
 let access:CollaborationAccess;
 if(personal&&!governed) access={userId:actorId,actorId,projectId,role:'owner',capabilities:['read','comment','develop','review','manage'] as Capability[],teamId:null,logicalOwnerId:actorId,authorityEpoch:'',membershipRevision:0,path:personal.path,name:personal.name};
 else access=new CollaborationRepository(db,actorId).access(projectId);
 const safe=db.prepare('SELECT description,status FROM projects WHERE user_id=? AND id=?').get(access.userId,projectId) as {description:string|null;status:string};
 const project:Project=personal??{id:projectId,userId:access.userId,name:access.name,path:'',description:safe.description,status:safe.status,aiTool:'',techStack:null,isImported:false,templateId:null,createdAt:new Date(0),updatedAt:new Date(0)};
 return {access,project,privateDetailAllowed:!!personal,shared:!personal,revisionRequired:governed};
}
export function assertProjectManagerWrite(db:Database,actorId:string,projectId:string,manage=false) {
 const context=projectManagerAccess(db,actorId,projectId),caps=context.access.capabilities;
 if(manage?!caps.includes('manage'):!caps.includes('manage')&&!caps.includes('develop'))throw new CollaborationError(403,'PROJECT_CAPABILITY_DENIED');
 if(db.prepare("SELECT 1 FROM delivery_operations WHERE project_id=?").get(projectId))throw new CollaborationError(409,'DELIVERY_OPERATION_IN_PROGRESS');
 return context;
}
export function assertLegacyTaskExecution(db:Database,projectId:string) {
 if(governedProject(db,projectId))throw new CollaborationError(409,'SHARED_TASK_REQUIRES_DELIVERY');
}
