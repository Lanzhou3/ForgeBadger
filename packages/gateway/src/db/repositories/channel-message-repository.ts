import { randomUUID } from 'node:crypto';
import type { Database } from '../types.js';
export interface ChannelMessage {
  id:string; chat_id:string|null; route_id:string; account_id:string; event_id:string; message_id:string;
  payload_encrypted:string; payload_digest:string; status:string; run_id:string|null; created_at:number; conversation_id:string|null;
}
export class ChannelMessageRepository {
  constructor(private readonly db:Database, private readonly userId:string) {}
  get(id:string):ChannelMessage|undefined {
    return this.db.prepare('SELECT * FROM channel_messages WHERE user_id=? AND id=?').get(this.userId,id) as ChannelMessage|undefined;
  }
  duplicates(accountId:string,eventId:string,messageId:string,chatId:string):(ChannelMessage & {event_match:number})[] {
    return this.db.prepare(`SELECT m.*, (m.event_id=? OR EXISTS(SELECT 1 FROM channel_message_events e
      WHERE e.user_id=m.user_id AND e.account_id=m.account_id AND e.inbox_id=m.id AND e.event_id=?)) AS event_match
      FROM channel_messages m WHERE m.user_id=? AND m.account_id=? AND
      (m.event_id=? OR EXISTS(SELECT 1 FROM channel_message_events e WHERE e.user_id=m.user_id AND e.account_id=m.account_id AND e.inbox_id=m.id AND e.event_id=?)
        OR (m.message_id=? AND (m.chat_id=? OR m.chat_id IS NULL)))`)
      .all(eventId,eventId,this.userId,accountId,eventId,eventId,messageId,chatId) as (ChannelMessage & {event_match:number})[];
  }
  recordEvent(accountId:string,eventId:string,inboxId:string):void {
    this.db.prepare('INSERT INTO channel_message_events(user_id,account_id,event_id,inbox_id) VALUES (?,?,?,?) ON CONFLICT(user_id,account_id,event_id) DO NOTHING').run(this.userId,accountId,eventId,inboxId);
  }
  insert(input:{chatId:string;routeId:string;accountId:string;eventId:string;messageId:string;encrypted:string;digest:string;conversationId?:string;command?:boolean}):ChannelMessage {
    const pending=this.db.prepare("SELECT count(*) AS n FROM channel_messages WHERE user_id=? AND status='pending'").get(this.userId) as {n:number};
    if(!input.command && pending.n>=1000)throw new Error('CHANNEL_BACKLOG_FULL');
    const id=randomUUID();
    this.db.prepare('INSERT INTO channel_messages(id,user_id,route_id,account_id,event_id,message_id,payload_encrypted,payload_digest,created_at,chat_id,conversation_id,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id,this.userId,input.routeId,input.accountId,input.eventId,input.messageId,input.encrypted,input.digest,Date.now(),input.chatId,input.conversationId??null,input.command?'command':'pending');
    return this.get(id)!;
  }
  legacyActiveRuns(): string[] {
    return (this.db.prepare(`SELECT r.id FROM channel_messages m JOIN copilot_runs r ON r.user_id=m.user_id AND r.id=m.run_id
      WHERE m.user_id=? AND m.chat_id IS NULL AND r.status IN ('pending','running','awaiting_approval')`).all(this.userId) as {id:string}[]).map(r=>r.id);
  }
  recordChat(id: string, chatId: string): void {
    this.db.prepare('UPDATE channel_messages SET chat_id=? WHERE user_id=? AND id=? AND chat_id IS NULL').run(chatId,this.userId,id);
  }
  bindConversation(id:string,conversationId:string):void {
    this.db.prepare('UPDATE channel_messages SET conversation_id=? WHERE user_id=? AND id=?')
      .run(conversationId,this.userId,id);
  }
  candidates():ChannelMessage[] {
    return this.db.prepare(`SELECT m.* FROM channel_messages m WHERE m.user_id=? AND m.status='pending'
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
