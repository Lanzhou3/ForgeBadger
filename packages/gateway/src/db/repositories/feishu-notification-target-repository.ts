import { randomUUID } from 'node:crypto';
import type { Database } from '../types.js';

export interface FeishuNotificationGroup {
  id:string; accountId:string; accountRevision:number; chatId:string; name:string;
  available:boolean; revision:number; checkedAt:number;
}
const columns='id,account_id AS accountId,account_revision AS accountRevision,chat_id AS chatId,name,available,revision,checked_at AS checkedAt';
type GroupRow=Omit<FeishuNotificationGroup,'available'> & {available:number};
const fromRow=(row:GroupRow):FeishuNotificationGroup=>({...row,available:row.available===1});

export class FeishuNotificationTargetRepository {
  constructor(private readonly db:Database,private readonly userId:string) {}
  account():{id:string;configRevision:number}|undefined {
    return this.db.prepare('SELECT id,config_revision AS configRevision FROM feishu_channel_accounts WHERE user_id=?').get(this.userId) as {id:string;configRevision:number}|undefined;
  }
  group(id:string):FeishuNotificationGroup|undefined {
    const row=this.db.prepare(`SELECT ${columns} FROM feishu_notification_groups WHERE user_id=? AND id=?`).get(this.userId,id) as GroupRow|undefined;
    return row?fromRow(row):undefined;
  }
  groups(accountId:string,accountRevision:number):FeishuNotificationGroup[] {
    return (this.db.prepare(`SELECT ${columns} FROM feishu_notification_groups WHERE user_id=? AND account_id=? AND account_revision=? ORDER BY name,id`)
      .all(this.userId,accountId,accountRevision) as GroupRow[]).map(fromRow);
  }
  knownGroupChatIds(accountId:string,accountRevision:number):string[] {
    const rows=this.db.prepare(`SELECT DISTINCT s.chat_id FROM channel_route_sessions s
      JOIN channel_routes r ON r.user_id=s.user_id AND r.id=s.route_id
      JOIN channel_identities i ON i.user_id=r.user_id AND i.id=r.identity_id
      WHERE s.user_id=? AND s.chat_type='group' AND i.channel='feishu' AND i.account_id=? AND i.account_revision=?
      AND r.status='active' AND i.status='active' LIMIT 100`).all(this.userId,accountId,accountRevision) as {chat_id:string}[];
    return rows.map(row=>row.chat_id);
  }
  synchronize(accountId:string,accountRevision:number,groups:{chatId:string;name:string}[]):void {
    this.db.transaction(()=>{
      const existing=this.groups(accountId,accountRevision);
      const found=new Set(groups.map(group=>group.chatId));
      for(const group of existing)if(!found.has(group.chatId))this.invalidate(group.id);
      for(const group of groups)this.db.prepare(`INSERT INTO feishu_notification_groups
        (id,user_id,account_id,account_revision,chat_id,name,checked_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(user_id,account_id,account_revision,chat_id) DO UPDATE SET
        name=excluded.name,checked_at=excluded.checked_at,available=1,
        revision=feishu_notification_groups.revision+CASE WHEN feishu_notification_groups.available=0 THEN 1 ELSE 0 END`)
        .run(randomUUID(),this.userId,accountId,accountRevision,group.chatId,group.name,Date.now());
    }).immediate();
  }
  invalidate(id:string):void {
    this.db.prepare('UPDATE feishu_notification_groups SET available=0,revision=revision+1,checked_at=? WHERE user_id=? AND id=? AND available=1')
      .run(Date.now(),this.userId,id);
  }
}
