export type TeamRole='owner'|'admin'|'member';
export interface TeamRow {id:string;user_id:string;owner_id:string;name:string;state:'active'|'closed';revision:number;created_at:number;updated_at:number}
export interface TeamMember {userId:string;email:string;displayName:string|null;role:TeamRole;state:'active'|'leaving'|'left';revision:number}
export interface TeamAccess {team:TeamRow;actorId:string;role:TeamRole;membershipRevision:number}
export interface Handoff {projectId:string;newOwnerId?:string|undefined;assigneeId:string|null;reviewerId:string|null}
export interface OffboardingRow {id:string;user_id:string;team_id:string;actor_id:string;member_id:string;confirmation_hash:string;revision:number;plan_digest:string;handoffs_json:string;state:'planned'|'stopping'|'completed';expires_at:number;created_at:number;pending_stops:number;error:string|null}
