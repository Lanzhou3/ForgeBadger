import { z } from 'zod';
import type { Database } from '../../db/types.js';
import { decryptSecret, encryptSecret, type EncryptedSecret } from '../../crypto/secret-box.js';
import { ChannelDeliveryRepository, type ChannelDelivery } from '../../db/repositories/channel-delivery-repository.js';
import { NativeChannelInbox } from './native-channel-inbox.js';
import { CopilotRunLedger } from '../agent/run-ledger.js';
import type { TrustedChannelPeer } from './channel-identity-service.js';

export type NativeChannelSender = (input: {
  peer: TrustedChannelPeer; text: string; deliveryId: string; signal: AbortSignal;
  authorize(): void;
}) => Promise<{ status: 'delivered'|'failed'|'unknown'; messageId?: string }>;
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
      const phases=terminal.has(run.status)?['terminal']:ledger.log.listPendingActions(run.id).filter(p=>p.status==='pending').map(p=>`approval:${p.id}`);
      for(const phase of phases) {
        let text='状态已失效，请在 Web Copilot 查看。';
        try {
          const result=this.inbox.result(item.id,this.peer(item.id));
          text=phase==='terminal' && result.status==='completed'
            ? result.messages.filter(m=>m.role==='assistant' && m.kind==='text').slice(-1).map(m=>m.content).join('') || '任务已完成，请在 Web Copilot 查看详情。'
            : phase.startsWith('approval:') ? '任务等待审批，请在 Web Copilot 中查看并决定。' : '任务已结束或需要核查，请在 Web Copilot 查看状态。';
        } catch { /* Persist a non-sensitive phase marker; send authorization will cancel it. */ }
        this.records.enqueue(item.id,phase,JSON.stringify(encryptSecret(boundedText(channelAnswer(text)),{key:this.key})));
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
    let result:{status:ChannelDelivery['status'];messageId?:string};
    try {
      authorize();
      const text=channelAnswer(z.string().max(16_000).parse(decryptSecret(JSON.parse(item.payload_encrypted) as EncryptedSecret,{key:this.key})));
      result=await this.send({peer:this.peer(item.inbox_id),text,deliveryId:item.id,signal,authorize});
    } catch(error) { result={status:error instanceof SendAuthorityError?'cancelled':'unknown'}; }
    if(signal.aborted || !this.db.open)return;
    this.records.finish(item,result.status,result.messageId);
  }
  private peer(messageId:string):TrustedChannelPeer {
    const item=this.inbox.messages.get(messageId);if(!item)throw new Error('CHANNEL_MESSAGE_MISSING');
    return (JSON.parse(decryptSecret(JSON.parse(item.payload_encrypted) as EncryptedSecret,{key:this.key})) as {peer:TrustedChannelPeer}).peer;
  }
  private assertCurrent(item:ChannelDelivery):void {
    const result=this.inbox.result(item.inbox_id,this.peer(item.inbox_id));
    if(item.phase==='terminal' ? !terminal.has(result.status) : result.status!=='awaiting_approval' || !result.pendingActions.some(p=>`approval:${p.id}`===item.phase && p.status==='pending')) {
      throw new Error('CHANNEL_DELIVERY_PHASE_STALE');
    }
  }
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
