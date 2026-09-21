import type { Database } from '../../db/types.js';
import type { DeliveryRun } from './types.js';
import { CollaborationError } from './types.js';

export function acquireOperation(db:Database,run:DeliveryRun,kind:'verify'|'review'|'integrate'|'pull_request',expectedCommit:string):void {
 try { db.prepare('INSERT INTO delivery_operations(run_id,user_id,project_id,kind,expected_commit,created_at) VALUES(?,?,?,?,?,?)')
  .run(run.id,run.user_id,run.project_id,kind,expectedCommit,Date.now()); }
 catch { throw new CollaborationError(409,'DELIVERY_OPERATION_IN_PROGRESS'); }
}
export function releaseOperation(db:Database,run:DeliveryRun):void {
 db.prepare('DELETE FROM delivery_operations WHERE run_id=? AND user_id=?').run(run.id,run.user_id);
}
export function assertNoOperation(db:Database,run:DeliveryRun):void {
 if(db.prepare('SELECT 1 FROM delivery_operations WHERE run_id=? AND user_id=?').get(run.id,run.user_id)) throw new CollaborationError(409,'DELIVERY_OPERATION_IN_PROGRESS');
}
