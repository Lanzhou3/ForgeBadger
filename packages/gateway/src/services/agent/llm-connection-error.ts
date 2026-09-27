import { AgentError } from './types.js';

export type ConnectionStage = 'dns' | 'tcp' | 'tls' | 'request' | 'response' | 'backoff';
export type RequestDelivery = 'not_sent' | 'possibly_sent';
const dns = new Set(['EAI_AGAIN', 'ENOTFOUND', 'EAI_FAIL', 'ENODATA']);
const tcp = new Set(['ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN']);
const tls = new Set(['CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION', 'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE']);
const timeouts = new Set(['ETIMEDOUT', 'ERR_SOCKET_CONNECTION_TIMEOUT', 'ERR_TLS_HANDSHAKE_TIMEOUT']);
const transient = new Set(['EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN', 'ETIMEDOUT', 'ERR_SOCKET_CONNECTION_TIMEOUT']);
const allowed = new Set([...dns, ...tcp, ...tls, ...timeouts, 'ABORT_ERR']);

export interface ConnectionDiagnostic {
  category: 'dns' | 'tcp' | 'tls' | 'timeout' | 'cancelled' | 'connection';
  nativeCodes: string[];
  stage: ConnectionStage;
  delivery: RequestDelivery;
  /** Attempts within this fetch, excluding the separate HTTP status retry loop. */
  attempts: number;
  elapsedMs: number;
  retryScope: 'connection_fetch';
}

const categoryCodes: Record<ConnectionDiagnostic['category'], string> = {
  dns: 'AGENT_LLM_DNS_ERROR', tcp: 'AGENT_LLM_TCP_ERROR', tls: 'AGENT_LLM_TLS_ERROR',
  timeout: 'AGENT_LLM_TIMEOUT', cancelled: 'AGENT_LLM_CANCELLED', connection: 'AGENT_LLM_CONNECTION_ERROR',
};

export class LlmConnectionError extends AgentError {
  constructor(readonly diagnostic: ConnectionDiagnostic) {
    super(categoryCodes[diagnostic.category], connectionFailureReason(diagnostic.category));
  }
}

function nativeCodes(error: unknown, depth = 0): string[] {
  if (!error || typeof error !== 'object' || depth > 3) return ['UNKNOWN'];
  const value = error as { code?: unknown; errors?: unknown; cause?: unknown };
  if (Array.isArray(value.errors) && value.errors.length) return [...new Set(value.errors.slice(0, 8).flatMap(e => nativeCodes(e, depth + 1)))];
  if (typeof value.code === 'string') return [allowed.has(value.code) ? value.code : 'UNKNOWN'];
  if (value.cause) return nativeCodes(value.cause, depth + 1);
  return ['UNKNOWN'];
}

export function connectionError(error: unknown, stage: ConnectionStage, delivery: RequestDelivery, signal?: AbortSignal): LlmConnectionError {
  const codes = nativeCodes(error);
  const aborted = signal?.aborted;
  const category = aborted ? (signal.reason instanceof Error && signal.reason.name === 'TimeoutError' ? 'timeout' : 'cancelled')
    : codes.every(c => dns.has(c)) ? 'dns' : codes.some(c => timeouts.has(c)) ? 'timeout'
    : codes.some(c => tls.has(c)) ? 'tls' : codes.every(c => tcp.has(c)) ? 'tcp' : 'connection';
  return new LlmConnectionError({ category, nativeCodes: codes, stage, delivery, attempts: 1, elapsedMs: 0, retryScope: 'connection_fetch' });
}

export function canRetryConnection(error: unknown): error is LlmConnectionError {
  return error instanceof LlmConnectionError && error.diagnostic.delivery === 'not_sent'
    && error.diagnostic.nativeCodes.every(code => transient.has(code));
}

export function connectionFailureReason(category: ConnectionDiagnostic['category']): string {
  return ({ dns: '模型服务域名解析失败，请检查 DNS 或模型服务地址。', tcp: '与模型服务的网络连接失败。',
    tls: '模型服务的 TLS 安全连接失败，请检查证书和 HTTPS 配置。', timeout: '模型服务连接或响应超时。',
    cancelled: '模型请求已取消。', connection: '模型服务连接异常，未取得可用回复。' })[category];
}

export function connectionFailureNotice(code: string): string | undefined {
  for (const category of ['dns', 'tcp', 'tls', 'timeout', 'cancelled', 'connection'] as const) {
    if (categoryCodes[category] === code) return connectionFailureReason(category);
  }
  if (code === 'AGENT_LLM_FAILED') return '模型调用失败，未取得可用回复；该错误未保留具体原因，无法确定是否为网络故障。';
  return undefined;
}

export function connectionDiagnosticText(error: LlmConnectionError): string {
  const d = error.diagnostic;
  const delivery = d.delivery === 'not_sent' ? '本次模型请求尚未发送' : '本次模型请求可能已发送，未自动重试此连接错误';
  return `${error.message}\n错误类别：${error.code}；原始错误码：${d.nativeCodes.join(' / ')}；阶段：${d.stage}。\n${delivery}。连接尝试：${d.attempts} 次（本次 HTTP 请求内），耗时 ${d.elapsedMs} 毫秒。`;
}
