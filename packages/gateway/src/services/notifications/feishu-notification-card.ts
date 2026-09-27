import type { Notification } from '../../db/repositories/notification-repository.js';
import type { FeishuNotificationDelivery } from '../../db/repositories/feishu-notification-repository.js';
import { redactAgentText } from '../agent/redaction.js';

const titles: Record<FeishuNotificationDelivery['event_type'], string> = {
  attention: '需要你处理', failure: '任务失败或权限被拒绝', completion: '执行结果通知',
  lifecycle: '会话状态变化', app_action: '应用操作通知', automation: '自动化任务结果', test: '测试通知',
};
interface CliProgress { title: string }
const cliProgress = new Map<string, CliProgress>([
  ['task_completed', { title: '回复结束' }],
  ['session_ended', { title: 'CLI 会话结束' }],
  ['permission_prompt', { title: '等待授权' }],
  ['permission_denied', { title: '授权被拒绝' }],
  ['task_failed', { title: '本轮执行失败' }],
  ['task_interrupted', { title: '本轮执行中断' }],
  ['attention', { title: '等待你处理' }],
]);

function clean(value: unknown, max = 200, singleLine = false): string {
  if (typeof value !== 'string') return '';
  const redacted = redactAgentText(value).trim();
  const chars = Array.from(singleLine ? redacted.replace(/\s+/g, ' ') : redacted);
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('');
}

function readPayload(notification: Notification | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(notification?.payload ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* Legacy notifications still have identity and message columns. */ }
  return {};
}

function notificationTime(date: Date): string {
  if (!Number.isFinite(date.getTime())) return '未知';
  // Use the Gateway's local timezone and display its offset explicitly.
  const parts = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')} (${part('timeZoneName')})`;
}

function contextLines(notification: Notification | undefined, payload: Record<string, unknown>): string[] {
  return [
    ['最近请求', payload.last_prompt],
    ['项目', payload.project_name], ['会话', payload.session_name],
    ['会话 ID', notification?.sessionId], ['CLI', payload.adapter],
    ['通知主题', payload.title], ['操作', payload.tool_name],
  ].flatMap(([label, value]) => {
    const text = clean(value, label === '最近请求' ? 400 : 200, true);
    return text ? [`${label}：${text}`] : [];
  });
}

function notificationSummary(notification: Notification | undefined, payload: Record<string, unknown>, progress: CliProgress | undefined): string {
  if (!notification) return '飞书通知连接正常。启用后，新通知将以卡片发送到所选会话。';
  const summary = clean(notification.message, 1400);
  // Replace only the exact boilerplate produced by our CLI hooks. Keep real error/detail text.
  const label = new Map([['claude', 'Claude Code'], ['codex', 'Codex'], ['opencode', 'OpenCode'], ['kimi', 'Kimi Code'], ['pi', 'PI']])
    .get(typeof payload.adapter === 'string' ? payload.adapter : 'claude');
  const boilerplate = label && ['task completed', 'session ended', 'task was interrupted', 'task failed', 'notification']
    .some(suffix => summary === `${label} ${suffix}`);
  return progress && boilerplate ? '' : summary;
}

export function renderFeishuNotificationCard(item: FeishuNotificationDelivery, notification: Notification | undefined, webBaseUrl: string) {
  const payload = readPayload(notification);
  const isCli = notification?.type === 'claude_notification';
  const progress = isCli ? cliProgress.get(String(payload.notification_type)) : undefined;
  const lines = contextLines(notification, payload);
  lines.push(`通知时间：${notificationTime(notification?.createdAt ?? new Date(item.created_at))}`);
  const elements: Record<string, unknown>[] = [{ tag: 'div', text: { tag: 'plain_text', content: lines.join('\n') } }];
  const summary = notificationSummary(notification, payload, progress);
  // All model/CLI-supplied content remains plain_text, never executable Markdown or button values.
  if (summary) elements.push({ tag: 'div', text: { tag: 'plain_text', content: summary } });
  const path = notificationPath(notification, payload);
  if (webBaseUrl && path) elements.push({ tag: 'button', text: { tag: 'plain_text', content: isCli && notification.sessionId ? '查看会话' : '查看详情' },
    type: 'primary', behaviors: [{ type: 'open_url', default_url: webBaseUrl + path }] });
  const subject = clean(payload.last_prompt, 52, true) || clean(payload.session_name, 36, true) || '会话';
  const identity = isCli && notification.sessionId ? ` · ${subject} [${clean(notification.sessionId, 128, true).slice(0, 8)}]` : '';
  return { schema: '2.0', config: { update_multi: true }, header: {
    title: { tag: 'plain_text', content: `ForgeBadger · ${progress?.title ?? titles[item.event_type]}${identity}` },
    template: item.event_type === 'failure' ? 'red' : item.event_type === 'attention' ? 'orange' : 'blue',
  }, body: { elements } };
}

function notificationPath(notification:Notification|undefined,payload:Record<string,unknown>):string|undefined {
  if(!notification)return '/notifications';
  if(notification.type==='claude_notification' && notification.sessionId)return `/sessions/${encodeURIComponent(notification.sessionId)}`;
  if(notification.type==='app_action_notification')return '/models';
  if(notification.type==='copilot_automation' && typeof payload.automation_id==='string' && /^[\w-]{1,128}$/.test(payload.automation_id))return `/copilot/automations/${encodeURIComponent(payload.automation_id)}`;
  return '/notifications';
}
