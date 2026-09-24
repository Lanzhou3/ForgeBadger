import { createHash } from 'node:crypto';
import { z } from 'zod';
import { encryptSecret, decryptSecret, type EncryptedSecret } from '../../crypto/secret-box.js';
import type { Database } from '../../db/types.js';
import { ChannelMessageRepository } from '../../db/repositories/channel-message-repository.js';
import { ChannelIdentityService, ChannelIdentityError, type TrustedChannelPeer } from './channel-identity-service.js';
import { CopilotRunLedger } from '../agent/run-ledger.js';
import { normalizeFeishuEvent } from '../integrations/feishu-event-normalizer.js';

const id=z.string().min(1).max(128);
const messageSchema=z.object({eventId:id,messageId:id,text:z.string().min(1).max(32000)}).strict();
export class NativeChannelInbox {
  readonly messages:ChannelMessageRepository;
  private readonly authority:ChannelIdentityService;
  constructor(private readonly db:Database,private readonly userId:string,private readonly masterKey:string) {
    this.messages=new ChannelMessageRepository(db,userId);
    this.authority=new ChannelIdentityService(db,userId);
  }
  /** Authenticated SDK context only; never expose this as a public JSON relay. */
  receive(peer:TrustedChannelPeer,raw:unknown) {
    const input=messageSchema.parse(raw);
    if(/^\s*\/pair\b/i.test(input.text))throw new Error('CHANNEL_PAIRING_REQUIRES_SEPARATE_HANDLER');
    return this.db.transaction(()=>{
      const route=this.authority.records.peerRoute(peer);
      if(!route)throw new ChannelIdentityError();
      this.authority.admit(route.id,peer);
      const payload=JSON.stringify({peer,text:input.text});
      const digest=createHash('sha256').update(JSON.stringify([route.id,peer.channel,peer.accountId,peer.accountRevision,peer.externalUserId,peer.chatId,peer.chatType,input.text])).digest('hex');
      const existing=this.messages.duplicates(peer.accountId,input.eventId,input.messageId);
      if(existing.length) {
        if(existing.length!==1||existing[0]!.payload_digest!==digest||existing[0]!.message_id!==input.messageId)throw new Error('CHANNEL_REPLAY_CONFLICT');
        this.messages.recordEvent(peer.accountId,input.eventId,existing[0]!.id);
        return {id:existing[0]!.id,duplicate:true};
      }
      const stored=this.messages.insert({routeId:route.id,accountId:peer.accountId,eventId:input.eventId,messageId:input.messageId,
        encrypted:JSON.stringify(encryptSecret(payload,{key:this.masterKey})),digest});
      this.messages.recordEvent(peer.accountId,input.eventId,stored.id);
      return {id:stored.id,duplicate:false};
    }).immediate();
  }
  /** Native runtime owns execution/recovery after commit. This worker never replays an adopted run. */
  adoptNext():{status:'idle'|'rejected'}|{status:'adopted';runId:string;messageId:string} {
    return this.db.transaction(()=>{
      for(const item of this.messages.candidates()) {
      let input:{peer:TrustedChannelPeer;text:string};
      let admission:ReturnType<ChannelIdentityService['admit']>;
      try {
        input=JSON.parse(decryptSecret(JSON.parse(item.payload_encrypted) as EncryptedSecret,{key:this.masterKey}));
        admission=this.authority.admit(item.route_id,input.peer);
      } catch { this.messages.reject(item.id); return {status:'rejected'} as const; }
      if(this.messages.busy(admission.conversationId))continue;
      const runId=new CopilotRunLedger(this.db,this.userId).admit({userId:this.userId,conversationId:admission.conversationId,userText:input.text},16);
      this.messages.adopt(item.id,runId);
      return {status:'adopted',runId,messageId:item.id} as const;
      }
      return {status:'idle'} as const;
    }).immediate();
  }
  result(messageId:string,peer:TrustedChannelPeer) {
    const item=this.messages.get(id.parse(messageId)); if(!item)throw new ChannelIdentityError();
    this.authority.admit(item.route_id,peer);
    const ledger=new CopilotRunLedger(this.db,this.userId);
    const run=item.run_id?ledger.get(item.run_id):undefined;
    return {messageId:item.id,status:run?.status??item.status,runId:item.run_id,
      messages:run?ledger.log.listRunMessages(run.id):[],pendingActions:run?ledger.log.listPendingActions(run.id):[]};
  }
}

/** Strip the leading "@bot" mention tokens a platform renders into group text. */
function stripBotMention(text: string): string {
  return text.replace(/^(?:@[A-Za-z0-9_]+(?:\s+|$))+/, '').trim();
}

/** The supervisor must fence this handler and derive account/revision from the active SDK connection. */
export function createFeishuNativeIngress(input:{db:Database;userId:string;masterKey:string;accountId:string;accountRevision:number}) {
  const inbox=new NativeChannelInbox(input.db,input.userId,input.masterKey);
  const authority=new ChannelIdentityService(input.db,input.userId);
  return (envelope:unknown,context:{botOpenId:string})=>{
    const event=normalizeFeishuEvent(envelope,{accountId:input.accountId,botOpenId:context.botOpenId,eventType:'im.message.receive_v1'});
    if(event?.kind!=='message'||event.threadId) return {status:'ignored'} as const;
    const isGroup=event.chatType==='group';
    if(event.chatType!=='p2p'&&!isGroup) return {status:'ignored'} as const;
    if(isGroup&&event.mentionedBot!==true) return {status:'ignored'} as const;
    const text=isGroup?stripBotMention(event.text):event.text;
    if(!text) return {status:'ignored'} as const;
    const peer:TrustedChannelPeer=isGroup
      ?{channel:'feishu',accountId:input.accountId,accountRevision:input.accountRevision,externalUserId:event.senderOpenId,chatId:event.chatId,chatType:'group',mentionedBot:true}
      :{channel:'feishu',accountId:input.accountId,accountRevision:input.accountRevision,externalUserId:event.senderOpenId,chatId:event.chatId,chatType:'p2p'};
    if(/^\s*\/pair\b/i.test(text)) {
      if(isGroup) return {status:'ignored'} as const;
      const match=/^\/pair ([A-Za-z0-9_-]{43})$/.exec(text.trim());
      if(!match)throw new Error('CHANNEL_PAIRING_FORMAT_INVALID');
      const pairing=authority.claimPairing(match[1]!,peer);
      return {status:'pairing_claimed',pairingId:pairing.id} as const;
    }
    return {status:'admitted',...inbox.receive(peer,{eventId:event.eventId,messageId:event.messageId,text})} as const;
  };
}

/** Normalized Telegram message produced by the Telegram transport's event normalizer (A3). */
export interface NativeTelegramMessageEvent {
  kind: 'message';
  /** Transport-scoped dedup id, e.g. `tg:<update_id>`. */
  eventId: string;
  messageId: string;
  chatId: string;
  chatType: 'p2p' | 'group';
  senderId: string;
  text: string;
  /** True when the update explicitly @-mentions the bot (mention entity or /cmd@botname). */
  mentionedBot: boolean;
}

const telegramEventSchema=z.object({
  kind:z.literal('message'),
  eventId:id,
  messageId:id,
  chatId:id,
  chatType:z.enum(['p2p','group']),
  senderId:id,
  text:z.string().min(1).max(32000),
  mentionedBot:z.boolean()
}).strict();

/** The polling supervisor must fence this handler with the active account/revision. */
export function createTelegramNativeIngress(input:{db:Database;userId:string;masterKey:string;accountId:string;accountRevision:number}) {
  const inbox=new NativeChannelInbox(input.db,input.userId,input.masterKey);
  const authority=new ChannelIdentityService(input.db,input.userId);
  return (rawEvent:unknown)=>{
    const parsed=telegramEventSchema.safeParse(rawEvent);
    if(!parsed.success) return {status:'ignored'} as const;
    const event=parsed.data;
    const isGroup=event.chatType==='group';
    if(isGroup&&!event.mentionedBot) return {status:'ignored'} as const;
    const text=isGroup?stripBotMention(event.text):event.text;
    if(!text) return {status:'ignored'} as const;
    const peer:TrustedChannelPeer=isGroup
      ?{channel:'telegram',accountId:input.accountId,accountRevision:input.accountRevision,externalUserId:event.senderId,chatId:event.chatId,chatType:'group',mentionedBot:true}
      :{channel:'telegram',accountId:input.accountId,accountRevision:input.accountRevision,externalUserId:event.senderId,chatId:event.chatId,chatType:'p2p'};
    if(/^\s*\/pair\b/i.test(text)) {
      if(isGroup) return {status:'ignored'} as const;
      const match=/^\/pair ([A-Za-z0-9_-]{43})$/.exec(text.trim());
      if(!match)throw new Error('CHANNEL_PAIRING_FORMAT_INVALID');
      const pairing=authority.claimPairing(match[1]!,peer);
      return {status:'pairing_claimed',pairingId:pairing.id} as const;
    }
    return {status:'admitted',...inbox.receive(peer,{eventId:event.eventId,messageId:event.messageId,text})} as const;
  };
}
