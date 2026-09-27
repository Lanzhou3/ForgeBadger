import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { Notification } from '../src/db/repositories/notification-repository.js';
import type { FeishuNotificationDelivery } from '../src/db/repositories/feishu-notification-repository.js';
import { renderFeishuNotificationCard } from '../src/services/notifications/feishu-notification-card.js';

const occurredAt = new Date('2026-09-27T04:43:24Z');
const item: FeishuNotificationDelivery = {
  id: 'delivery', notification_id: 'notice', test_key: null, event_type: 'completion',
  subscription_revision: 1, identity_revision: 1, target_id: 'private:owner', target_revision: 1,
  status: 'pending', error_code: null, claim_token: null, lease_until: null,
  attempt_count: 0, next_attempt_at: 0, expires_at: 0, created_at: occurredAt.getTime() + 60_000,
};
function notice(payload: Record<string, unknown> = {}, patch: Partial<Notification> = {}): Notification {
  return {
    id: 'notice', userId: 'owner', type: 'claude_notification', category: 'session_event',
    titleKey: 'notifications.taskCompleted', message: 'Codex task completed', href: 'https://untrusted.example',
    sessionId: '58999b1a-1234-4321-9876-123456789abc', isRead: false,
    createdAt: occurredAt, updatedAt: occurredAt,
    payload: JSON.stringify({ notification_type: 'task_completed', project_name: 'ForgeBadger',
      session_name: 'ForgeBadger', adapter: 'codex', ...payload }), ...patch,
  };
}
function rendered(notification = notice()) {
  return renderFeishuNotificationCard(item, notification, 'https://forge.example');
}
function text(card: ReturnType<typeof rendered>): string {
  return JSON.stringify(card);
}

it('distinguishes identically named sessions in the header and includes the full session ID', () => {
  const first = rendered();
  const second = rendered(notice({}, { sessionId: '749956e9-1234-4321-9876-123456789abc' }));
  assert.match(first.header.title.content, /58999b1a/);
  assert.match(second.header.title.content, /749956e9/);
  assert.match(text(first), /会话 ID：58999b1a-1234-4321-9876-123456789abc/);
  assert.match(text(first), /https:\/\/forge.example\/sessions\/58999b1a-/);
  assert.doesNotMatch(text(first), /untrusted.example/);
});

it('keeps the event in the title without repeated progress or acceptance boilerplate', () => {
  const card = rendered();
  assert.match(card.header.title.content, /回复结束/);
  assert.doesNotMatch(text(card), /进展：|不代表|通过验收|Codex task completed|任务已完成"/);
});

for (const [type, title, detail] of [
  ['session_ended', 'CLI 会话结束', '不代表任务已完成'],
  ['permission_prompt', '等待授权', '确认是否允许'],
  ['permission_denied', '授权被拒绝', '尚未获准'],
  ['task_failed', '本轮执行失败', '检查错误'],
  ['task_interrupted', '本轮执行中断', '确认是否继续'],
  ['attention', '等待你处理', '查看提示'],
]) it(`explains ${type} as its own event state`, () => {
  const card = rendered(notice({ notification_type: type }, { message: '' }));
  assert.match(card.header.title.content, new RegExp(title));
  assert.doesNotMatch(text(card), /进展：|不代表/);
});

it('uses the recent request to distinguish same-project sessions, with a snapshot label', () => {
  const card = rendered(notice({ last_prompt: '检查飞书群聊通知，先 review 不要修改' }));
  assert.match(card.header.title.content, /检查飞书群聊通知/);
  assert.match(text(card), /最近请求：检查飞书群聊通知，先 review 不要修改/);
  assert.match(text(card), /58999b1a/);
});

it('shows existing title, tool and detail as bounded redacted plain text', () => {
  const card = rendered(notice({ title: '修复通知 sk-SECRET12345678', tool_name: 'Bash' },
    { message: '**检查失败**\n' + '甲'.repeat(2000) + 'Bearer secret-token' }));
  const output = text(card);
  assert.match(output, /修复通知 \[REDACTED\]/);
  assert.match(output, /操作：Bash/);
  assert.match(output, /\*\*检查失败\*\*/);
  assert.doesNotMatch(output, /SECRET12345678|secret-token|甲{1401}/);
  assert.match(output, /…/);
  for (const element of card.body.elements) {
    if (element.tag === 'div') assert.equal((element.text as { tag: string }).tag, 'plain_text');
  }
});

it('uses the persisted event time, not delivery time, and labels the timezone', () => {
  const first = rendered();
  const delayed = renderFeishuNotificationCard({ ...item, created_at: item.created_at + 86400_000 }, notice(), 'https://forge.example');
  assert.deepEqual(first, delayed);
  assert.match(text(first), /通知时间：/);
  assert.doesNotMatch(text(first), /2026-09-27T/);
  assert.match(text(first), /GMT|UTC/);
});

it('handles legacy or malformed payloads without inventing progress or trusting payload identity', () => {
  const card = rendered(notice({}, { payload: '{broken' }));
  assert.match(text(card), /58999b1a/);
  assert.doesNotMatch(card.header.title.content, /任务已完成/);
  const spoofed = rendered(notice({ session_id: 'wrong-session', notification_type: 'invented' }));
  assert.doesNotMatch(text(spoofed), /wrong-session/);
  assert.doesNotMatch(text(spoofed), /进展：|任务已完成/);
});

it('keeps non-CLI cards free of CLI progress claims and supports both notification targets', () => {
  const app = rendered(notice({}, { type: 'app_action_notification', sessionId: null, message: '模型同步完成' }));
  assert.doesNotMatch(text(app), /本轮回复|验收|会话 ID/);
  const test = renderFeishuNotificationCard({ ...item, event_type: 'test' }, undefined, '');
  assert.match(text(test), /所选会话/);
  assert.doesNotMatch(text(test), /此私聊/);
});
