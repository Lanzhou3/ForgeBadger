import type { Database } from '../db/types.js';
import { NotificationRepository, type CreateNotificationInput } from '../db/repositories/notification-repository.js';
import { FeishuNotifications } from './notifications/feishu-notifications.js';

/** All production notification producers use this atomic in-app + optional delivery boundary. */
export class NotificationService {
  constructor(private readonly db:Database,private readonly userId:string) {}
  create(input:CreateNotificationInput) {
    return this.db.transaction(()=>{
      const notification=new NotificationRepository(this.db,this.userId).create(input);
      new FeishuNotifications(this.db,this.userId).enqueue(notification);
      return notification;
    }).immediate();
  }
}
