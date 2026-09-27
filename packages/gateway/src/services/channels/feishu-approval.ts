import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../../db/types.js';
import { decryptSecret, type EncryptedSecret } from '../../crypto/secret-box.js';
import { ChannelDeliveryRepository, type ChannelDelivery } from '../../db/repositories/channel-delivery-repository.js';
import { PlatformActionRepository } from '../../db/repositories/platform-action-repository.js';
import { AuditLogRepository } from '../../db/repositories/audit-log-repository.js';
import { NativeChannelInbox } from './native-channel-inbox.js';
import type { TrustedChannelPeer } from './channel-identity-service.js';
import { CopilotRunLedger, inputDigest } from '../agent/run-ledger.js';
import type { AgentPendingAction } from '../agent/types.js';
import { redactAgentText } from '../agent/redaction.js';
import { normalizeFeishuEvent } from '../integrations/feishu-event-normalizer.js';

export const FEISHU_APPROVAL_PHASE = 'approval-card-v1:';
export type FeishuInteractiveCard = Record<string, unknown>;
export type RecordChannelApproval = (input: { runId: string; actionId: string; approved: boolean }) => boolean;
const valueSchema = z.object({ action_id: z.literal('copilot_approval'), delivery_id: z.string().uuid(),
  approved: z.boolean(), signature: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const plain = (content: string) => ({ tag: 'plain_text', content });
const div = (content: string) => ({ tag: 'div', text: plain(content) });
const toast = (content: string, type: 'info' | 'error' | 'success' = 'info') => ({ toast: { type, content } });
const TTL_MS = 24 * 60 * 60_000;

/** SDK-only approval adapter; the channel delivery receipt is the authority anchor. */
export class FeishuApprovalService {
  constructor(private readonly db: Database, private readonly userId: string, private readonly key: string) {}

  private load(delivery: ChannelDelivery) {
    if (!delivery.phase.startsWith(FEISHU_APPROVAL_PHASE)) throw new Error('APPROVAL_PHASE_INVALID');
    const inbox = new NativeChannelInbox(this.db, this.userId, this.key);
    const message = inbox.messages.get(delivery.inbox_id);
    if (!message) throw new Error('APPROVAL_MESSAGE_MISSING');
    const stored = JSON.parse(decryptSecret(JSON.parse(message.payload_encrypted) as EncryptedSecret, { key: this.key })) as { peer: TrustedChannelPeer; text: string };
    if (stored.peer.channel !== 'feishu') throw new Error('APPROVAL_CHANNEL_INVALID');
    const result = inbox.result(message.id, stored.peer);
    const action = result.pendingActions.find(row => delivery.phase === FEISHU_APPROVAL_PHASE + row.id);
    if (!action || action.runId !== result.runId) throw new Error('APPROVAL_ACTION_MISSING');
    return { peer: stored.peer, request: stored.text, result, action };
  }

  private presentation(action: AgentPendingAction, delivery: ChannelDelivery) {
    const intent = action.stepId ? new PlatformActionRepository(this.db, this.userId).byKey(action.stepId) : undefined;
    let complete = true;
    let detail = '';
    try {
      const input = JSON.parse(action.inputJson) as Record<string, unknown>;
      detail = JSON.stringify(input, null, 2);
      if (action.tool === 'stop_session') {
        const target = intent ? JSON.parse(intent.resources_json).stopTarget as Record<string, unknown> | undefined : undefined;
        const planned = intent ? JSON.parse(intent.input_json) as Record<string, unknown> : undefined;
        complete = intent?.command_id === 'session.stop' && !!target && target.executionScope === 'session_process_group'
          && typeof target.taskTitle === 'string' && typeof target.sessionId === 'string'
          && [input, planned].every(value => value?.sessionId === target.sessionId
            && value?.observationId === target.observationId && value?.expectedTitle === target.taskTitle);
        if (complete) detail = `停止目标（整个会话进程组）：\n${JSON.stringify(target, null, 2)}\n\n参数：\n${detail}`;
      }
    } catch { complete = false; }
    const safe = redactAgentText(detail);
    // Count the complete redacted representation before clipping, never approve an incomplete preview.
    if (Buffer.byteLength(safe, 'utf8') > 6_000) complete = false;
    const expiresAt = Math.min(delivery.created_at + TTL_MS, intent?.expires_at ?? Infinity);
    return { detail: Array.from(safe).slice(0, 1500).join(''),
      complete: complete && Array.from(safe).length <= 1500 && expiresAt > Date.now(), expiresAt,
      evidenceDigest: inputDigest(JSON.stringify([action.tool, action.inputJson, action.inputDigest, intent?.resources_json ?? null])) };
  }

  private signature(delivery: ChannelDelivery, action: AgentPendingAction, approved: boolean): string {
    const presentation = this.presentation(action, delivery);
    return createHmac('sha256', this.key).update(JSON.stringify(['forgebadger.feishu.approval.v1', this.userId,
      delivery.id, action.id, action.runId, presentation.evidenceDigest, approved, presentation.expiresAt])).digest('hex');
  }

  card(delivery: ChannelDelivery): FeishuInteractiveCard {
    const { action, request } = this.load(delivery);
    const presentation = this.presentation(action, delivery);
    const button = (approved: boolean) => ({ tag: 'button', text: plain(approved ? '批准本次' : '拒绝'),
      type: approved ? 'primary' : 'danger', value: { action_id: 'copilot_approval', delivery_id: delivery.id,
        approved, signature: this.signature(delivery, action, approved) },
      ...(approved ? { confirm: { title: plain('确认批准本次操作？'), text: plain('仅批准卡片中展示的这一次操作，不授予后续操作权限。') } } : {}) });
    return { config: { wide_screen_mode: true, enable_forward: false, update_multi: true },
      header: { template: 'orange', title: plain('ForgeBadger · 操作待审批') }, elements: [
        div(`请求：${Array.from(redactAgentText(request)).slice(0, 300).join('')}`),
        div(`操作：${redactAgentText(action.tool)}\n审批编号：${action.id.slice(0, 8)}`),
        div(presentation.detail || '操作参数无法完整显示。'),
        div(presentation.complete ? '仅发起此任务且仍有权限的用户可以批准；本次授权不覆盖后续操作。'
          : '操作信息不完整、过长或已过期，请到 Web Copilot 核对后批准；也可在此拒绝。'),
        div(`卡片有效期至：${new Date(presentation.expiresAt).toISOString()}`),
        { tag: 'action', actions: [...(presentation.complete ? [button(true)] : []), button(false)] }
      ] };
  }

  /** No network/model calls: commit the same decision as Web, then the runtime pump resumes execution. */
  handle(envelope: unknown, accountId: string, accountRevision: number, decide: RecordChannelApproval) {
    try {
      const event = normalizeFeishuEvent(envelope, { accountId, eventType: 'card.action.trigger' });
      if (event?.kind !== 'card_action') return toast('无法识别此审批操作。', 'error');
      const parsed = valueSchema.safeParse(event.value);
      if (!parsed.success) return toast('审批卡片无效，请重新发起请求。', 'error');
      const value = parsed.data;
      return this.db.transaction(() => {
        const delivery = new ChannelDeliveryRepository(this.db, this.userId).get(value.delivery_id);
        if (!delivery || delivery.status !== 'delivered' || !delivery.provider_message_id
          || delivery.provider_message_id !== event.messageId) throw new Error('APPROVAL_RECEIPT_INVALID');
        const { peer, result, action, request } = this.load(delivery);
        if (peer.accountId !== accountId || peer.accountRevision !== accountRevision
          || peer.chatId !== event.chatId || peer.externalUserId !== event.senderOpenId) throw new Error('APPROVAL_PEER_INVALID');
        const expected = this.signature(delivery, action, value.approved);
        if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(value.signature, 'hex'))) throw new Error('APPROVAL_SIGNATURE_INVALID');
        const receipt = (message: string) => this.receipt(message, action, request, delivery);
        if (action.status !== 'pending' || result.status !== 'awaiting_approval') {
          return receipt(action.status === 'approved' ? '此操作已批准' : action.status === 'rejected' ? '此操作已拒绝' : '此审批已失效');
        }
        const view = this.presentation(action, delivery);
        if (view.expiresAt <= Date.now()) return receipt('审批卡片已过期，请到 Web Copilot 核对或重新发起请求。');
        if (value.approved && !view.complete) return toast('操作信息无法完整显示，请在 Web Copilot 核对后批准。', 'error');
        // Guard against changed raw input even when its recorded digest was not updated.
        if (inputDigest(action.inputJson) !== action.inputDigest) throw new Error('APPROVAL_INPUT_CHANGED');
        if (!decide({ runId: action.runId, actionId: action.id, approved: value.approved })) return receipt('此审批已失效');
        new AuditLogRepository(this.db, this.userId).create({ action: 'copilot.channel.approval', resourceType: 'copilot_pending_action',
          resourceId: action.id, details: { channel: 'feishu', deliveryId: delivery.id, approved: value.approved } });
        return receipt(value.approved ? '已批准，Copilot 将继续执行' : '已拒绝，Copilot 将继续处理');
      }).immediate();
    } catch { return toast('无法审批：身份、权限或卡片状态已变化，请核对当前任务。', 'error'); }
  }

  private receipt(message: string, action: AgentPendingAction, request: string, delivery: ChannelDelivery) {
    return { ...toast(message, 'info'), card: { type: 'raw', data: {
      config: { wide_screen_mode: true, enable_forward: false, update_multi: true },
      header: { template: 'blue', title: plain('ForgeBadger · 审批结果') }, elements: [div(message),
        div(`请求：${Array.from(redactAgentText(request)).slice(0, 300).join('')}`),
        div(`操作：${redactAgentText(action.tool)}\n审批编号：${action.id.slice(0, 8)}`),
        div(this.presentation(action, delivery).detail || '操作参数无法完整显示。')]
    } } };
  }
}
