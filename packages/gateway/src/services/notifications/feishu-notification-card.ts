import type { Notification } from '../../db/repositories/notification-repository.js';
import type { FeishuNotificationDelivery } from '../../db/repositories/feishu-notification-repository.js';
import { cliAdapterLabels, cliText, readCliSummary, type CliSummary } from './cli-observation.js';

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

const clean = cliText;

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

const errorCategories: Record<NonNullable<CliSummary['errorCategory']>, string> = {
  authentication: '认证错误', rate_limit: '配额或限频', network: '连接异常',
  permission: '权限不足', context_limit: '上下文限制', execution: '执行错误',
};
function legacyMessage(notification: Notification | undefined, payload: Record<string, unknown>): string {
  if (!notification) return '飞书通知连接正常。启用后，新通知将以卡片发送到所选会话。';
  const text = clean(notification.message, 1400);
  const label = cliAdapterLabels[payload.adapter as keyof typeof cliAdapterLabels] ?? 'Claude Code';
  return ['task completed', 'session ended', 'task was interrupted', 'task failed', 'notification']
    .some(suffix => text === `${label} ${suffix}`) ? '' : text;
}
function cliLines(notification: Notification, payload: Record<string, unknown>): string[] {
  const snapshot = readCliSummary(payload.cli_summary);
  const summary = snapshot;
  const identity = [clean(payload.project_name, 80, true),
    cliAdapterLabels[payload.adapter as keyof typeof cliAdapterLabels] ?? clean(payload.adapter, 40, true),
    payload.session_name === payload.project_name ? '' : clean(payload.session_name, 80, true),
    notification.sessionId ? `[${clean(notification.sessionId, 128, true).slice(0, 8)}]` : ''].filter(Boolean).join(' · ');
  const time = `通知时间：${notificationTime(notification.createdAt)}`;
  const lines = [identity];
  const kind = String(payload.notification_type);
  const message = legacyMessage(notification, payload);
  if (kind === 'task_failed') {
    lines.push(`失败原因：${summary?.error?.text ? clean(summary.error.text, 400) : snapshot?.errorCategory
      ? errorCategories[snapshot.errorCategory] : message || '未采集到具体错误，请查看会话'}`);
  } else if (['permission_prompt', 'permission_denied', 'attention'].includes(kind)) {
    lines.push(`待处理事项：${message || (kind === 'permission_denied' ? '操作未获授权，请查看会话' : '请在会话中查看提示并处理')}`);
  } else if (kind === 'task_completed') {
    lines.push(summary?.result?.text ? `结果（CLI 最终回复）：\n${clean(summary.result.text, 600)}`
      : `未采集到本轮结果，请查看会话${message ? '\n' + message : ''}`);
  } else if (message) lines.push(message);
  if (payload.tool_name) lines.push(`操作：${clean(payload.tool_name, 80, true)}`);
  if (summary?.verification.length) lines.push('命令验证证据：\n' + summary.verification.map(v => clean(v.text, 160)).join('\n'));
  else if (kind === 'task_completed') lines.push('未采集到命令验证证据');
  const request = clean(summary?.request ?? payload.last_prompt, 160, true);
  if (request) {
    // Remove only entire echoed lines, never a substring of a result claim.
    for (let i = 1; i < lines.length; i++) lines[i] = lines[i]!.split('\n')
      .filter(line => line.trim().replace(/\s+/g, ' ') !== request).join('\n');
    lines.push(`${snapshot?.identityQuality === 'exact_turn' ? '本轮请求' : '会话最近请求'}：${request}`);
  }
  if (summary?.progress.length) lines.push('最近进度（工具事件）：\n' + summary.progress.map(p => clean(p.text, 160)).join('\n'));
  if (summary?.nextAction) lines.push(`后续事项：${clean(summary.nextAction.text, 200)}`);
  if (summary) {
    lines.push(`最后观察：${notificationTime(new Date(summary.observedAt))}`);
    if (summary.identityQuality !== 'exact_turn') lines.push('轮次未确认，仅展示本次事件摘录');
    if (summary.startedAt && summary.endedAt && summary.endedAt >= summary.startedAt)
      lines.push(`本轮耗时：${Math.round((summary.endedAt - summary.startedAt) / 1000)} 秒`);
  }
  // Reserve the persisted event timestamp. Lower-priority fields are clipped
  // as a whole-card budget, never at UTF-16 surrogate boundaries.
  const budget = 1800 - Array.from(time).length - 1;
  return [clean(lines.filter(Boolean).join('\n'), budget), time];
}
export function renderFeishuNotificationCard(item: FeishuNotificationDelivery, notification: Notification | undefined,
  webBaseUrl: string, _legacyContentLevel?: 'status' | 'summary') {
  const payload = readPayload(notification);
  const isCli = notification?.type === 'claude_notification';
  const progress = isCli ? cliProgress.get(String(payload.notification_type)) : undefined;
  const lines = isCli ? cliLines(notification, payload) : [
    ...[['项目', payload.project_name], ['会话', payload.session_name], ['操作', payload.tool_name]].flatMap(([label, value]) => {
      const text = clean(value, 100, true); return text ? [`${label}：${text}`] : [];
    }), legacyMessage(notification, payload), `通知时间：${notificationTime(notification?.createdAt ?? new Date(item.created_at))}`,
  ];
  const elements: Record<string, unknown>[] = [{ tag: 'div', text: { tag: 'plain_text', content: lines.filter(Boolean).join('\n') } }];
  const path = notificationPath(notification, payload);
  if (webBaseUrl && path) elements.push({ tag: 'button', text: { tag: 'plain_text', content: isCli && notification.sessionId ? '查看会话' : '查看详情' },
    type: 'primary', behaviors: [{ type: 'open_url', default_url: webBaseUrl + path }] });
  return { schema: '2.0', config: { update_multi: true }, header: {
    title: { tag: 'plain_text', content: `ForgeBadger · ${progress?.title ?? titles[item.event_type]}` },
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
