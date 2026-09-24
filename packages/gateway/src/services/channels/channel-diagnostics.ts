import type { Database } from '../../db/types.js';
import { ChannelIdentityRepository } from '../../db/repositories/channel-identity-repository.js';
import { ProjectRepository } from '../../db/repositories/project-repository.js';
import { ModelProviderRepository } from '../../db/repositories/model-provider-repository.js';
import { CopilotConversationLog } from '../agent/conversation-log.js';
import type { ChannelPlatform } from './channel-identity-service.js';

export type ChannelDiagnosticKey = 'credentials' | 'connection' | 'identity' | 'route' | 'model' | 'delivery';
export interface ChannelDiagnosticCheck {
  key: ChannelDiagnosticKey;
  ok: boolean;
  detail: string;
  fixHint: string;
}
export interface ChannelDiagnostics {
  channel: ChannelPlatform;
  generatedAt: number;
  checks: ChannelDiagnosticCheck[];
}

interface ChannelAccountRow {
  id: string;
  enabled: number;
  connection_state: string;
  config_revision: number;
  last_connected_at: number | null;
  last_error_message: string | null;
  credential_configured: number;
}

const channelLabels: Record<ChannelPlatform, string> = { feishu: '飞书', telegram: 'Telegram' };
const credentialHints: Record<ChannelPlatform, string> = {
  feishu: '请在 Web 控制台「远程渠道」设置页第 1 步填写并保存飞书应用凭证（App ID 与 App Secret）。',
  telegram: '请在 Web 控制台「远程渠道」设置页第 1 步填写并保存 Telegram Bot Token（向 @BotFather 发送 /newbot 获取）。'
};

function accountTable(channel: ChannelPlatform): { table: 'feishu_channel_accounts' | 'telegram_channel_accounts'; credentialColumn: 'app_secret_encrypted' | 'bot_token_encrypted' } {
  return channel === 'telegram'
    ? { table: 'telegram_channel_accounts', credentialColumn: 'bot_token_encrypted' }
    : { table: 'feishu_channel_accounts', credentialColumn: 'app_secret_encrypted' };
}

function readAccount(db: Database, userId: string, channel: ChannelPlatform): ChannelAccountRow | undefined {
  const { table, credentialColumn } = accountTable(channel);
  return db.prepare(`
    SELECT id, enabled, connection_state, config_revision, last_connected_at,
      last_error_message, length(${credentialColumn}) > 0 AS credential_configured
    FROM ${table} WHERE user_id = ?
  `).get(userId) as ChannelAccountRow | undefined;
}

/** Server-side checklist behind GET /api/v1/channels/:channel/diagnostics. Owner-scoped, read-only. */
export function runChannelDiagnostics(db: Database, userId: string, masterKey: string, channel: ChannelPlatform): ChannelDiagnostics {
  const label = channelLabels[channel];
  const account = readAccount(db, userId, channel);
  const records = new ChannelIdentityRepository(db, userId);
  const identities = records.listIdentities().filter(identity => identity.channel === channel);
  const now = Date.now();

  const checks: ChannelDiagnosticCheck[] = [];

  checks.push(account && account.credential_configured === 1
    ? { key: 'credentials', ok: true, detail: `${label}应用凭证已保存。`, fixHint: '' }
    : { key: 'credentials', ok: false, detail: account ? `${label}应用凭证尚未保存。` : `尚未配置${label}渠道账号。`, fixHint: credentialHints[channel] });

  if (!account) {
    checks.push({ key: 'connection', ok: false, detail: `尚未配置${label}渠道账号。`, fixHint: credentialHints[channel] });
    checks.push({ key: 'identity', ok: false, detail: '尚无已确认身份。', fixHint: pairingHint(label) });
    checks.push({ key: 'route', ok: false, detail: '尚无渠道授权路由。', fixHint: routeHint('missing') });
  } else {
    checks.push(connectionCheck(account, label, channel));
    checks.push(identityCheck(identities, account, label));
    checks.push(routeCheck(db, userId, records, identities, account, label));
  }

  checks.push(modelCheck(db, userId, masterKey));
  checks.push(account ? deliveryCheck(db, userId, account.id) : { key: 'delivery', ok: false, detail: '尚无消息回传记录。', fixHint: credentialHints[channel] });

  return { channel, generatedAt: now, checks };
}

function connectionCheck(account: ChannelAccountRow, label: string, channel: ChannelPlatform): ChannelDiagnosticCheck {
  const detail = `连接状态：${account.connection_state}`
    + (account.last_error_message ? `；最近错误：${account.last_error_message}` : '')
    + (account.last_connected_at ? `；最近连接：${new Date(account.last_connected_at).toISOString()}` : '');
  if (account.connection_state === 'connected') {
    return { key: 'connection', ok: true, detail, fixHint: '' };
  }
  const fixHint = account.enabled !== 1
    ? `请先在「远程渠道」设置页启用${label}并保存凭证。`
    : channel === 'telegram'
      ? '保存并启用后会自动建立 long polling 连接；若长时间停留在此状态，请检查 Bot Token 是否有效或网络是否可达。'
      : '请检查应用凭证是否有效、Gateway 所在网络是否可达飞书开放平台；重新保存凭证后需重新配对。';
  return { key: 'connection', ok: false, detail, fixHint };
}

function identityCheck(identities: ReturnType<ChannelIdentityRepository['listIdentities']>, account: ChannelAccountRow, label: string): ChannelDiagnosticCheck {
  const current = identities.find(identity => identity.status === 'active' && identity.accountId === account.id && identity.accountRevision === account.config_revision);
  if (current) {
    return { key: 'identity', ok: true, detail: `已确认身份（用户 ${current.externalUserId}）。`, fixHint: '' };
  }
  const stale = identities.length > 0;
  return {
    key: 'identity', ok: false,
    detail: stale ? '已有身份与当前配置版本不匹配（保存凭证或重新启用后已失效）。' : '尚无已确认身份。',
    fixHint: pairingHint(label)
  };
}

function routeCheck(db: Database, userId: string, records: ChannelIdentityRepository, identities: ReturnType<ChannelIdentityRepository['listIdentities']>, account: ChannelAccountRow, label: string): ChannelDiagnosticCheck {
  const projects = new ProjectRepository(db, userId);
  const conversations = new CopilotConversationLog(db, userId);
  let problem: string | undefined;
  let problemRouteId: string | undefined;
  for (const route of records.listRoutes()) {
    if (route.status !== 'active') continue;
    const owner = identities.find(identity => identity.id === route.identityId);
    if (!owner || owner.status !== 'active') { problem = problem ?? 'identity'; continue; }
    if (owner.accountId !== account.id || owner.accountRevision !== account.config_revision) { problem = problem ?? 'revision'; continue; }
    if (account.enabled !== 1) { problem = problem ?? 'disabled'; continue; }
    const project = projects.getById(route.projectId);
    const conversation = conversations.getConversation(route.conversationId);
    if (!project) { problem = problem ?? 'project'; problemRouteId = problemRouteId ?? route.id; continue; }
    if (project.copilotAutonomy !== true) { problem = problem ?? 'autonomy_off'; problemRouteId = problemRouteId ?? route.id; continue; }
    if (conversation?.status !== 'active') { problem = problem ?? 'conversation'; problemRouteId = problemRouteId ?? route.id; continue; }
    return { key: 'route', ok: true, detail: '存在有效的渠道授权路由。', fixHint: '' };
  }
  return {
    key: 'route', ok: false,
    detail: problem === 'project' ? `路由 ${problemRouteId} 指向的项目不存在。`
      : problem === 'autonomy_off' ? `路由 ${problemRouteId} 所在项目未开启 Copilot 自治。`
      : problem === 'revision' ? '渠道授权与当前配置版本不匹配（需重新绑定）。'
      : problem === 'disabled' ? '渠道已停用，授权路由不可用。'
      : problem === 'identity' ? '渠道授权绑定的身份已失效。'
      : problem === 'conversation' ? '路由绑定的会话已失效。'
      : '尚无渠道授权路由。',
    fixHint: routeHint(problem ?? 'missing')
  };
}

function modelCheck(db: Database, userId: string, masterKey: string): ChannelDiagnosticCheck {
  const repo = new ModelProviderRepository(db, userId, masterKey);
  const profiles = repo.listModelProfiles();
  const profile = profiles.find(candidate => candidate.isDefault) ?? profiles[0];
  if (!profile) {
    return { key: 'model', ok: false, detail: 'Model Center 尚未配置任何模型。', fixHint: modelHint('missing') };
  }
  if (profile.status !== 'active') {
    return { key: 'model', ok: false, detail: `默认模型「${profile.name}」已停用。`, fixHint: modelHint('inactive') };
  }
  const provider = repo.getProviderProfile(profile.providerProfileId);
  if (!provider || provider.status !== 'active') {
    return { key: 'model', ok: false, detail: `模型「${profile.name}」所属提供商已停用或不存在。`, fixHint: modelHint('provider') };
  }
  const credential = repo.listCredentials(provider.id).find(candidate => candidate.status === 'active');
  if (!credential) {
    return { key: 'model', ok: false, detail: `提供商「${provider.name}」没有可用的凭证。`, fixHint: modelHint('credential') };
  }
  const baseUrl = provider.apiFormat === 'anthropic'
    ? (provider.anthropicBaseUrl ?? profile.baseUrl) ?? provider.openaiBaseUrl
    : (provider.openaiBaseUrl ?? profile.baseUrl) ?? provider.anthropicBaseUrl;
  if (!baseUrl) {
    return { key: 'model', ok: false, detail: `提供商「${provider.name}」未配置 Base URL。`, fixHint: modelHint('baseUrl') };
  }
  return { key: 'model', ok: true, detail: `已配置可用模型「${profile.name}」。`, fixHint: '' };
}

function deliveryCheck(db: Database, userId: string, accountId: string): ChannelDiagnosticCheck {
  const last = db.prepare(`
    SELECT d.status, d.created_at AS createdAt FROM channel_deliveries d
    JOIN channel_messages m ON m.user_id = d.user_id AND m.id = d.inbox_id
    WHERE d.user_id = ? AND m.account_id = ? ORDER BY d.rowid DESC LIMIT 1
  `).get(userId, accountId) as { status: string; createdAt: number } | undefined;
  if (!last) return { key: 'delivery', ok: true, detail: '尚无消息回传记录。', fixHint: '' };
  const detail = `最近回传：${last.status}（${new Date(last.createdAt).toISOString()}）。`;
  if (last.status === 'failed' || last.status === 'unknown') {
    return { key: 'delivery', ok: false, detail, fixHint: '最近一条回复发送失败：请检查渠道连接状态与凭证；若刚重新保存过凭证，请确认已完成重新配对。' };
  }
  return { key: 'delivery', ok: true, detail, fixHint: '' };
}

function pairingHint(label: string): string {
  return `请在 Web 控制台「远程渠道」设置页第 2 步生成配对码，并在${label}私聊中向机器人发送 /pair <配对码>，回到控制台确认身份。`;
}

function routeHint(problem: string): string {
  if (problem === 'project') return '删除失效路由，选择有效项目后重新绑定。';
  if (problem === 'autonomy_off') return '在 Web 控制台项目设置中开启该项目的 Copilot 自治后，渠道授权即可生效。';
  if (problem === 'conversation') return '路由绑定的会话已失效：请回「远程渠道」第 3 步重新绑定渠道授权。';
  if (problem === 'revision' || problem === 'identity') return '配置或身份已变化：请先重新完成身份配对，再回「远程渠道」第 3 步重新绑定渠道授权。';
  if (problem === 'disabled') return '请先在「远程渠道」设置页启用渠道，再重新绑定渠道授权。';
  return '选择已确认身份与目标项目，点击「启用远程操作」创建渠道授权。';
}

function modelHint(problem: string): string {
  if (problem === 'inactive') return '请在 Web 控制台 Model Center 启用该模型，或将其他可用模型设为默认。';
  if (problem === 'provider') return '请在 Web 控制台 Model Center 启用模型对应的提供商，或为默认模型更换可用提供商。';
  if (problem === 'credential') return '请在 Web 控制台 Model Center 为该提供商创建并启用 API 凭证。';
  if (problem === 'baseUrl') return '请在 Web 控制台 Model Center 为该提供商配置 Base URL。';
  return '请在 Web 控制台 Model Center 添加模型提供商、创建并启用凭证，并将模型设为默认。';
}
