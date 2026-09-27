import type { Database } from '../../db/types.js';
import { ChannelIdentityRepository } from '../../db/repositories/channel-identity-repository.js';
import { ModelProviderRepository, type ModelProfile } from '../../db/repositories/model-provider-repository.js';
import { CopilotPreferencesRepository } from '../../db/repositories/copilot-preferences-repository.js';
import { createAgentLlmClient } from '../agent/llm-client.js';
import { AgentError } from '../agent/types.js';
import { redactAgentText } from '../agent/redaction.js';

const usage = '/model 查看当前模型；/model list [页码] 查看可用配置；/model <提供商/模型或配置 ID> 切换；/model default 跟随默认。';
const pageSize = 10;

/** Uses the same local resolver as execution; never discovers providers or makes a model request. */
export class ChannelModelCommand {
  private readonly models: ModelProviderRepository;
  private readonly sessions: ChannelIdentityRepository;
  private readonly llm: ReturnType<typeof createAgentLlmClient>;

  constructor(db: Database, userId: string, key: string) {
    this.models = new ModelProviderRepository(db,userId,key);
    this.sessions = new ChannelIdentityRepository(db,userId);
    this.llm = createAgentLlmClient({ modelProviderRepository: this.models,
      preferences: new CopilotPreferencesRepository(db,userId,key) });
  }

  reply(conversationId: string, args: string, busy: () => boolean): string {
    if (!args || args.toLowerCase() === 'status') return `${this.current(conversationId)}\n${usage}`;
    if (/^list(?:\s|$)/i.test(args)) return this.list(args);
    if (args === 'help') return usage;
    if (busy()) return '当前会话仍有任务或排队消息，请先 /stop 或等待完成，再切换模型。/model 和 /model list 仍可查看。';
    if (args.toLowerCase() === 'default') {
      this.sessions.setSessionModel(conversationId,null);
      return `已恢复跟随默认，仅影响当前远程会话。\n${this.current(conversationId)}`;
    }
    const selected = this.resolve(args);
    if (typeof selected === 'string') return selected;
    const unavailable = this.unavailable(selected.id);
    if (unavailable) return `未切换模型：${unavailable}。请在模型中心检查配置，或发送 /model list。`;
    this.sessions.setSessionModel(conversationId,selected.id);
    return `已切换当前会话模型：${label(selected)}\n从下一条消息生效，保留历史；全局默认不变。/new 保留此选择，/model default 可恢复默认。`;
  }

  current(conversationId: string): string {
    const pin = this.sessions.sessionByConversation(conversationId)?.modelProfileId;
    const source = pin ? '当前会话固定' : '跟随默认';
    try {
      const info = this.llm.modelInfo(pin ?? undefined);
      const profile = this.models.getModelProfile(info.modelProfileId)!;
      return `当前模型：${label(profile)}（${source}）`;
    } catch (error) {
      const profile = pin ? this.models.getModelProfile(pin) : undefined;
      return `当前模型：${profile ? label(profile) : '不可用'}（${source}）\n${reason(error)}。请使用 /model list 选择，或 /model default 清除固定选择。`;
    }
  }

  private list(args: string): string {
    const match = /^list(?:\s+([1-9]\d*))?$/i.exec(args);
    if (!match) return '用法：/model list [正整数页码]';
    const page = Number(match[1] ?? 1);
    const choices = this.models.listModelProfiles().filter(model => !this.unavailable(model.id))
      .sort((a,b)=>a.id.localeCompare(b.id));
    if (!choices.length) return '当前没有可用的聊天模型配置。请先在 Web 模型中心配置模型、提供商和凭证。';
    const pages = Math.ceil(choices.length / pageSize);
    if (!Number.isSafeInteger(page) || page > pages) return `页码超出范围，请使用 /model list 1 至 /model list ${pages}。`;
    return [
      `可用模型配置（第 ${page}/${pages} 页，共 ${choices.length} 个；本地校验，未测试远程连通）：`,
      ...choices.slice((page-1)*pageSize,page*pageSize).map(model=>`${label(model)}\n/model ${model.id}`),
      '也可使用 /model 提供商/模型；同名配置请使用上面的配置 ID。',
      ...(page<pages ? [`下一页：/model list ${page+1}`] : [])
    ].join('\n');
  }

  private resolve(selector: string): ModelProfile | string {
    const exact = this.models.getModelProfile(selector);
    if (exact) return exact;
    const profiles = this.models.listModelProfiles();
    const qualified = profiles.filter(m=>`${m.providerKey}/${m.modelId}` === selector);
    const matches = qualified.length ? qualified : profiles.filter(m=>m.modelId === selector || m.name === selector);
    if (matches.length > 1) return '模型名称对应多个配置，未切换。请使用 /model list 中的准确配置 ID。';
    return matches[0] ?? '未找到此模型配置，未切换。请使用 /model list 查看当前账号的模型。';
  }

  private unavailable(modelId: string): string | undefined {
    try { this.llm.modelInfo(modelId); return undefined; } catch (error) { return reason(error); }
  }
}

function label(model: ModelProfile): string {
  const clean = (value: string) => redactAgentText(value).replace(/[\r\n\t]/g,' ').slice(0,100);
  return `${clean(model.providerName)} / ${clean(model.name)} [${clean(model.providerKey)}/${clean(model.modelId)}]`;
}

function reason(error: unknown): string {
  const messages: Record<string,string> = {
    AGENT_NO_MODEL: '尚未配置模型或所选模型已删除', AGENT_MODEL_INACTIVE: '模型已停用',
    AGENT_PROVIDER_INACTIVE: '提供商已停用或删除', AGENT_NO_CREDENTIAL: '缺少可用凭证',
    AGENT_NO_BASE_URL: '缺少服务地址', AGENT_MODEL_NOT_CHAT: '模型未声明聊天能力',
    AGENT_MODEL_TRANSPORT_UNSUPPORTED: 'Copilot 暂不支持此提供商协议'
  };
  return error instanceof AgentError ? messages[error.code] ?? '模型配置不可用' : '模型配置无法读取';
}
