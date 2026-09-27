import { connectionFailureNotice } from '../agent/llm-connection-error.js';
import { z } from 'zod';
import type { Database } from '../../db/types.js';
import { decryptSecret, encryptSecret, type EncryptedSecret } from '../../crypto/secret-box.js';
import { ChannelDeliveryRepository, type ChannelDelivery } from '../../db/repositories/channel-delivery-repository.js';
import { NativeChannelInbox } from './native-channel-inbox.js';
import { CopilotRunLedger, type RunRecord } from '../agent/run-ledger.js';
import type { TrustedChannelPeer } from './channel-identity-service.js';
import { boundFeishuReply } from '../integrations/feishu-markdown.js';
import { FeishuApprovalService, FEISHU_APPROVAL_PHASE, type FeishuInteractiveCard } from './feishu-approval.js';

export type NativeChannelSender = (input: {
  peer: TrustedChannelPeer; text: string; deliveryId: string; signal: AbortSignal;
  authorize(): void;
  nextPart?: number;
  card?: FeishuInteractiveCard;
  checkpoint?(nextPart: number, messageId: string): void;
}) => Promise<{ status: 'delivered'|'failed'|'unknown'|'retry'|'continue'; messageId?: string; retryAfterMs?: number }>;
class SendAuthorityError extends Error {}
const terminal = new Set(['completed','failed','cancelled','stopped','indeterminate']);
export class NativeChannelDelivery {
  readonly records: ChannelDeliveryRepository;
  private readonly inbox: NativeChannelInbox;
  constructor(private readonly db:Database,private readonly userId:string,private readonly key:string,private readonly send:NativeChannelSender) {
    this.records=new ChannelDeliveryRepository(db,userId);
    this.inbox=new NativeChannelInbox(db,userId,key);
  }
  project():void {
    for(const candidate of this.records.candidates()) {
      const item=this.inbox.messages.get(candidate.id)!;
      const ledger=new CopilotRunLedger(this.db,this.userId);
      const run=ledger.get(item.run_id!)!;
      const prefix=this.peer(item.id).channel==='feishu'?FEISHU_APPROVAL_PHASE:'approval:';
      const phases=terminal.has(run.status)?['terminal']:ledger.log.listPendingActions(run.id).filter(p=>p.status==='pending').map(p=>`${prefix}${p.id}`);
      for(const phase of phases) {
        let text='状态已失效，请在 Web Copilot 查看。';
        try {
          const result=this.inbox.result(item.id,this.peer(item.id));
          text=phase==='terminal' && result.status==='completed'
            ? result.messages.filter(m=>m.role==='assistant' && m.kind==='text').slice(-1).map(m=>m.content).join('') || '任务已完成，请在 Web Copilot 查看详情。'
            : phase.startsWith('approval:') || phase.startsWith(FEISHU_APPROVAL_PHASE) ? '任务等待审批，请在 Web Copilot 中查看并决定。'
            : phase==='terminal' ? terminalNotice(run)
            : '任务已结束或需要核查，请在 Web Copilot 查看状态。';
        } catch { /* Persist a non-sensitive phase marker; send authorization will cancel it. */ }
        const answer=channelAnswer(text);
        const bounded=this.peer(item.id).channel==='feishu'?boundFeishuReply(answer):boundedText(answer);
        this.records.enqueue(item.id,phase,JSON.stringify(encryptSecret(bounded,{key:this.key})));
      }
    }
  }
  async runOnce(signal:AbortSignal):Promise<void> {
    if(signal.aborted || !this.db.open)return;
    this.project();
    const item=this.records.claim();if(!item)return;
    const authorize=()=>{
      try {
        if(signal.aborted || !this.db.open)throw new Error('CHANNEL_SEND_STOPPED');
        if(!this.records.owns(item))throw new Error('CHANNEL_SEND_CLAIM_LOST');
        this.assertCurrent(item);
      } catch { throw new SendAuthorityError('CHANNEL_SEND_AUTHORITY_INVALID'); }
    };
    let result:{status:ChannelDelivery['status']|'retry'|'continue';messageId?:string;retryAfterMs?:number};
    try {
      authorize();
      const limit=this.peer(item.inbox_id).channel==='feishu'?70_000:16_000;
      const text=channelAnswer(z.string().max(limit).parse(decryptSecret(JSON.parse(item.payload_encrypted) as EncryptedSecret,{key:this.key})));
      const card=item.phase.startsWith(FEISHU_APPROVAL_PHASE)?new FeishuApprovalService(this.db,this.userId,this.key).card(item):undefined;
      result=await this.send({peer:this.peer(item.inbox_id),text,...(card?{card}:{}),deliveryId:item.id,signal,authorize,nextPart:item.next_part,
        checkpoint:(nextPart,messageId)=>{ authorize(); this.records.checkpoint(item,nextPart,messageId); }});
    } catch(error) { result={status:error instanceof SendAuthorityError?'cancelled':'unknown'}; }
    if(signal.aborted || !this.db.open)return;
    if(result.status==='continue') this.records.continue(item);
    else if(result.status==='retry') this.records.retry(item,result.retryAfterMs ?? 1000);
    else this.records.finish(item,result.status,result.messageId);
  }
  private peer(messageId:string):TrustedChannelPeer {
    const item=this.inbox.messages.get(messageId);if(!item)throw new Error('CHANNEL_MESSAGE_MISSING');
    return (JSON.parse(decryptSecret(JSON.parse(item.payload_encrypted) as EncryptedSecret,{key:this.key})) as {peer:TrustedChannelPeer}).peer;
  }
  private assertCurrent(item:ChannelDelivery):void {
    const result=this.inbox.result(item.inbox_id,this.peer(item.inbox_id));
    if(item.phase==='command') {
      if(result.status!=='command')throw new Error('CHANNEL_COMMAND_RECEIPT_STALE');
      return;
    }
    const prefix=this.peer(item.inbox_id).channel==='feishu'?FEISHU_APPROVAL_PHASE:'approval:';
    if(item.phase==='terminal' ? !terminal.has(result.status) : result.status!=='awaiting_approval' || !result.pendingActions.some(p=>`${prefix}${p.id}`===item.phase && p.status==='pending')) {
      throw new Error('CHANNEL_DELIVERY_PHASE_STALE');
    }
  }
}

/** Surface a failed run's category without leaking raw error text; codes double as the category label. */
function terminalNotice(run:RunRecord):string {
  if(run.status==='indeterminate')return '操作可能已执行，但未取得送达或执行确认。为避免重复操作，系统不会自动重发。请打开对应 CLI 会话核对输入框和输出，再决定如何继续。';
  if(run.status==='cancelled')return '本轮 Copilot 任务已取消。此前已派发给 CLI 的任务可能仍在运行，请查看对应会话。';
  if(run.status==='stopped') {
    const reason = run.stop_reason === 'COPILOT_TIME_BUDGET' ? '达到运行时间上限'
      : run.stop_reason === 'COPILOT_TOKEN_BUDGET' ? '达到模型用量上限'
      : run.stop_reason === 'COPILOT_NO_PROGRESS' ? '连续操作未取得进展' : '达到运行限制或需要人工检查';
    return `本轮 Copilot 已停止：${reason}。不代表 CLI 任务已完成，请在 Web Copilot 查看执行记录。`;
  }
  if(run.status!=='failed')return '本轮状态需要核查，请在 Web Copilot 查看执行记录。';
  if(run.error==='AGENT_NO_MODEL')return '任务失败：尚未配置模型，请先在 Web 控制台的 Model Center 配置模型提供商。';
  if(run.error==='AGENT_LLM_INVALID_RESPONSE')return '本轮回复失败：模型返回的数据格式或流式响应不符合协议，未能生成完整答复。之前已执行的操作不会自动撤销或重发，请在 Web Copilot 执行记录查看具体诊断。';
  const connectionReason = connectionFailureNotice(run.error ?? '');
  if (connectionReason) return `任务失败：${connectionReason}${run.error === 'AGENT_LLM_FAILED' ? '' : '请在 Web Copilot 会话记录查看诊断详情。'}`;
  const category=run.error && /^[A-Z][A-Z0-9_]{2,}$/.test(run.error)?run.error:'执行错误';
  return `任务失败：${category}，请在 Web Copilot 查看详情。`;
}

/** Bound actual UTF-8 JSON content, including escaping, rather than JS character count. */
function boundedText(text:string):string {
  if(Buffer.byteLength(JSON.stringify({text}),'utf8')<=12_000)return text;
  let end=Math.min(text.length,12_000);
  const suffix='\n…内容已截断，请在 Web Copilot 查看完整结果。';
  while(Buffer.byteLength(JSON.stringify({text:text.slice(0,end)+suffix}),'utf8')>12_000)end=Math.floor(end*0.8);
  return text.slice(0,end)+suffix;
}

/** Provider inline reasoning is not a channel reply. Keep the native transcript unchanged. */
function channelAnswer(source:string):string {
  let depth=0;let cursor=0;let answer='';
  for(const match of source.matchAll(/<\/?think\s*>/gi)) {
    if(depth===0)answer+=source.slice(cursor,match.index);
    depth=match[0][1]==='/'?Math.max(0,depth-1):depth+1;
    cursor=match.index+match[0].length;
  }
  if(depth===0)answer+=source.slice(cursor);
  return answer.trim() || '任务已完成，请在 Web Copilot 查看详情。';
}
