import type { Database } from '../../db/types.js';
import { decryptSecret, encryptSecret, type EncryptedSecret } from '../../crypto/secret-box.js';
import { ChannelMessageRepository, type ChannelMessage } from '../../db/repositories/channel-message-repository.js';
import { ChannelDeliveryRepository } from '../../db/repositories/channel-delivery-repository.js';
import { ChannelCommandRepository } from '../../db/repositories/channel-command-repository.js';
import { ChannelIdentityService, type TrustedChannelPeer } from './channel-identity-service.js';
import { CopilotRunLedger } from '../agent/run-ledger.js';
import { CopilotConversationLog } from '../agent/conversation-log.js';
import { ChannelModelCommand } from './channel-model-command.js';

const help = [
  '远程 Copilot 命令：',
  '/help — 查看命令',
  '/new — 开始新对话，保留旧历史；需当前任务和回复已结束',
  '/stop — 停止当前对话的 Copilot 任务并取消排队消息，不关闭 CLI 终端',
  '/status — 查看当前对话的执行和排队状态',
  '/model — 查看或切换当前会话模型；/model list 列出可用配置',
  '/playbooks — 列出可用 Copilot 操作指南',
  '/skills — 查看 Skills 管理说明',
  '/pair <配对码> — 私聊配对，随后在 Web 确认'
].join('\n');

/** A leading slash token is a command; absolute paths and embedded slashes remain ordinary text. */
export function parseChannelCommand(text: string): {name: string; args: string} | undefined {
  const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return undefined;
  const name = match[1]!.toLowerCase(), args = match[2]?.trim() ?? '';
  if (!args && (name === 'skills' || name === 'playbooks')) return undefined;
  return { name, args };
}

/** Called inside durable inbox admission's transaction, before acknowledging the provider event. */
export class ChannelCommands {
  private readonly records: ChannelCommandRepository;
  private readonly messages: ChannelMessageRepository;
  constructor(private readonly db: Database, private readonly userId: string, private readonly key: string) {
    this.records = new ChannelCommandRepository(db,userId);
    this.messages = new ChannelMessageRepository(db,userId);
  }

  execute(item: ChannelMessage, peer: TrustedChannelPeer, text: string): string[] {
    const command = parseChannelCommand(text);
    if (!command) return [];
    const authority = new ChannelIdentityService(this.db,this.userId);
    let { conversationId } = authority.admit(item.route_id,peer);
    if (item.conversation_id !== conversationId) throw new Error('CHANNEL_COMMAND_SCOPE_CHANGED');
    const cancelled: string[] = [];
    let reply: string;
    const supported = ['help','new','stop','status','model','skills','playbooks'].includes(command.name);
    if (!supported) reply = '未知命令。请发送 /help 查看支持的命令。';
    else if (command.name === 'model') reply = new ChannelModelCommand(this.db,this.userId,this.key).reply(conversationId,command.args,()=>
      this.records.activeRuns(conversationId).length>0 || this.records.queuedFollowups(conversationId)>0 || this.pending(item,peer,conversationId).length>0);
    else if (command.args) reply = `用法：/${command.name}（不接受参数）。发送 /help 查看说明。`;
    else if (command.name === 'help') reply = help;
    else {
      const pending = this.pending(item,peer,conversationId);
      const active = this.records.activeRuns(conversationId);
      const queued = pending.length + this.records.queuedFollowups(conversationId);
      if (command.name === 'status') reply = `当前会话：${conversationId}\n状态：${active.length ? '处理中' : '空闲'}\n执行中：${active.length}；等待审批：${active.filter(r=>r.status==='awaiting_approval').length}；排队消息：${queued}\n${new ChannelModelCommand(this.db,this.userId,this.key).current(conversationId)}`;
      else if (command.name === 'stop') {
        const ledger = new CopilotRunLedger(this.db,this.userId);
        for (const run of active) if (ledger.cancel(run.id,'channel_stop')) cancelled.push(run.id);
        for (const message of pending) this.messages.reject(message.id);
        this.records.cancelFollowups(conversationId);
        reply = `已停止 ${cancelled.length} 个 Copilot 任务，取消 ${queued} 条排队消息。CLI 终端和已启动的外部操作不会因此关闭或撤销。`;
      } else if (active.length || queued || this.records.hasUnsettledReplies(conversationId,item.id)) {
        reply = '当前会话仍有任务、排队消息或待发送回复。请先 /stop 或等待回复送达，再发送 /new。';
      } else {
        const next = new CopilotConversationLog(this.db,this.userId).createConversation('远程新对话');
        authority.records.replaceSession(item.route_id,peer,conversationId,next.id);
        conversationId = next.id;
        this.messages.bindConversation(item.id,conversationId);
        reply = `已开始新对话：${conversationId}。旧历史已保留，后续消息使用新的对话上下文。`;
      }
    }
    new ChannelDeliveryRepository(this.db,this.userId).enqueue(item.id,'command',JSON.stringify(encryptSecret(reply,{key:this.key})));
    return cancelled;
  }

  private pending(item: ChannelMessage, peer: TrustedChannelPeer, conversationId: string): ChannelMessage[] {
    return this.messages.candidates().filter(candidate => {
      if (candidate.route_id !== item.route_id) return false;
      if (candidate.conversation_id) return candidate.conversation_id === conversationId;
      // Pre-0116 pending inputs have encrypted scope but no immutable conversation binding yet.
      const stored = JSON.parse(decryptSecret(JSON.parse(candidate.payload_encrypted) as EncryptedSecret,{key:this.key})) as {peer: TrustedChannelPeer};
      return stored.peer.channel === peer.channel && stored.peer.accountId === peer.accountId && stored.peer.chatType === peer.chatType
        && stored.peer.chatId === peer.chatId && (stored.peer.threadId ?? '') === (peer.threadId ?? '');
    });
  }
}
