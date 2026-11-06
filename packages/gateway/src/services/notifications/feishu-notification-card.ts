import type { Notification } from '../../db/repositories/notification-repository.js';
import type { FeishuNotificationDelivery } from '../../db/repositories/feishu-notification-repository.js';
import { renderNotificationContent } from './notification-content.js';

export function renderFeishuNotificationCard(item: FeishuNotificationDelivery, notification: Notification | undefined,
  webBaseUrl: string, _legacyContentLevel?: 'status' | 'summary') {
  const content = renderNotificationContent(item, notification, webBaseUrl, { testMessage: '飞书通知连接正常。启用后，新通知将以卡片发送到所选会话。' });
  const elements: Record<string, unknown>[] = [{ tag: 'div', text: { tag: 'plain_text', content: content.body } }];
  if (content.link) elements.push({ tag: 'button', text: { tag: 'plain_text', content: content.link.label },
    type: 'primary', behaviors: [{ type: 'open_url', default_url: content.link.url }] });
  return { schema: '2.0', config: { update_multi: true }, header: {
    title: { tag: 'plain_text', content: content.title },
    template: content.tone,
  }, body: { elements } };
}
