import { randomUUID } from 'node:crypto';
import type { Database } from '../types.js';
export interface ChannelMessage {
  id:string; route_id:string; account_id:string; event_id:string; message_id:string;
  payload_encrypted:string; payload_digest:string; status:string; run_id:string|null; created_at:number;
}
export class ChannelMessageRepository {
  constructor(private readonly db:Database, private readonly userId:string) {}
  get(id:string):ChannelMessage|undefined {
    return this.db.prepare('SELECT * FROM channel_messages WHERE user_id=? AND id=?').get(this.userId,id) as ChannelMessage|undefined;
  }
  duplicates(accountId:string,eventId:string,messageId:string):ChannelMessage[] {
    return this.db.prepare('SELECT * FROM channel_messages WHERE user_id=? AND account_id=? AND (id IN (SELECT inbox_id FROM channel_message_events WHERE user_id=? AND account_id=? AND event_id=?) OR message_id=?)').all(this.userId,accountId,this.userId,accountId,eventId,messageId) as ChannelMessage[];
  }
  recordEvent(accountId:string,eventId:string,inboxId:string):void {
    this.db.prepare('INSERT INTO channel_message_events(user_id,account_id,event_id,inbox_id) VALUES (?,?,?,?) ON CONFLICT(user_id,account_id,event_id) DO NOTHING').run(this.userId,accountId,eventId,inboxId);
  }
  insert(input:{routeId:string;accountId:string;eventId:string;messageId:string;encrypted:string;digest:string}):ChannelMessage {
    const pending=this.db.prepare("SELECT count(*) AS n FROM channel_messages WHERE user_id=? AND status='pending'").get(this.userId) as {n:number};
    if(pending.n>=1000)throw new Error('CHANNEL_BACKLOG_FULL');
    const id=randomUUID();
    this.db.prepare('INSERT INTO channel_messages(id,user_id,route_id,account_id,event_id,message_id,payload_encrypted,payload_digest,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id,this.userId,input.routeId,input.accountId,input.eventId,input.messageId,input.encrypted,input.digest,Date.now());
    return this.get(id)!;
  }
  candidates():ChannelMessage[] {
    return this.db.prepare(`SELECT m.* FROM channel_messages m WHERE m.user_id=? AND m.status='pending'
      AND NOT EXISTS (SELECT 1 FROM channel_messages earlier WHERE earlier.user_id=m.user_id AND earlier.route_id=m.route_id AND earlier.status='pending' AND earlier.rowid<m.rowid)
      ORDER BY m.rowid LIMIT 1000`).all(this.userId) as ChannelMessage[];
  }
  busy(conversationId:string):boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM copilot_runs WHERE user_id=? AND conversation_id=? AND status IN ('pending','running','awaiting_approval') LIMIT 1").get(this.userId,conversationId));
  }
  adopt(id:string,runId:string):void {
    if(this.db.prepare("UPDATE channel_messages SET status='adopted',run_id=? WHERE user_id=? AND id=? AND status='pending'").run(runId,this.userId,id).changes!==1)throw new Error('CHANNEL_ADOPTION_CONFLICT');
  }
  reject(id:string):void {
    this.db.prepare("UPDATE channel_messages SET status='rejected' WHERE user_id=? AND id=? AND status='pending'").run(this.userId,id);
  }
}
