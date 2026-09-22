import type {Database} from '../db/types.js';
import {AuthSessionRepository} from '../db/repositories/auth-session-repository.js';
import {UserRepository} from '../db/repositories/user-repository.js';

export function credentialEpoch(db:Database,userId:string):number {
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_auth_epochs'").get()) return 0;
 return (db.prepare('SELECT epoch FROM user_auth_epochs WHERE user_id=?').get(userId) as {epoch:number}|undefined)?.epoch??0;
}
export function jwtUserIsActive(db:Database,claims:{userId:string;authEpoch?:number}):boolean {
 const user=new UserRepository(db).findById(claims.userId);
 return user?.status==='active' && (claims.authEpoch??0)===credentialEpoch(db,claims.userId);
}
/** Call in the same transaction as the credential change. CLI processes are unaffected. */
export function revokeUserCredentials(db:Database,userId:string):number {
 db.prepare('INSERT INTO user_auth_epochs(user_id,epoch) VALUES(?,1) ON CONFLICT(user_id) DO UPDATE SET epoch=epoch+1').run(userId);
 return new AuthSessionRepository(db).deleteAllByUser(userId);
}
