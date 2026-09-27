import { z } from 'zod';
import { assertResolvedPublicHttpsEndpoint } from '../network-policy.js';

export interface FeishuReactionIO {
  fetch?: typeof fetch;
  validate?: typeof assertResolvedPublicHttpsEndpoint;
}

export class FeishuReactionError extends Error {
  constructor(readonly retryAfterMs = 30_000) { super('FEISHU_REACTION_REQUEST_FAILED'); }
}

const tokenUrl = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const tokenSchema = z.object({ code: z.literal(0), tenant_access_token: z.string().min(1) });
const receiptSchema = z.object({ code: z.literal(0), data: z.object({ reaction_id: z.string().min(1) }) });
const pageSchema = z.object({ code: z.literal(0), data: z.object({
  items: z.array(z.object({ reaction_id: z.string().min(1),
    operator: z.object({ operator_id: z.string(), operator_type: z.enum(['app', 'user']) }),
    reaction_type: z.object({ emoji_type: z.string() }) })),
  has_more: z.boolean(), page_token: z.string().optional()
}) });

/** All methods target a single original message, with a fresh authority check before each HTTP effect. */
export class FeishuReactions {
  private token?: string;
  private readonly request: typeof fetch;
  private readonly validate: typeof assertResolvedPublicHttpsEndpoint;
  private readonly signal: AbortSignal;
  private readonly base: string;

  constructor(private readonly input: {
    messageId: string; appId: string; signal: AbortSignal;
    credentials(): { appId: string; appSecret: string }; authorize(): void;
  }, io: FeishuReactionIO = {}) {
    this.request = io.fetch ?? fetch; this.validate = io.validate ?? assertResolvedPublicHttpsEndpoint;
    this.signal = AbortSignal.any([input.signal, AbortSignal.timeout(15_000)]);
    this.base = `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(input.messageId)}/reactions`;
  }

  async add(): Promise<string> {
    const response = await this.call(this.base, 'POST', { reaction_type: { emoji_type: 'Typing' } });
    return receiptSchema.parse(await response.json()).data.reaction_id;
  }

  async remove(reactionId: string): Promise<void> {
    const response = await this.call(`${this.base}/${encodeURIComponent(reactionId)}`, 'DELETE');
    if (response.status === 404) return;
    const parsed = z.object({ code: z.literal(0) }).safeParse(await response.json());
    if (!parsed.success) throw new FeishuReactionError();
  }

  async listOwn(): Promise<string[]> {
    const ids = new Set<string>(), tokens = new Set<string>();
    let token = '';
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ reaction_type: 'Typing', page_size: '50', ...(token ? { page_token: token } : {}) });
      const response = await this.call(`${this.base}?${query}`, 'GET');
      const data = pageSchema.parse(await response.json()).data;
      for (const item of data.items) if (item.operator.operator_type === 'app' &&
        item.operator.operator_id === this.input.appId && item.reaction_type.emoji_type === 'Typing') ids.add(item.reaction_id);
      if (!data.has_more) return [...ids];
      if (!data.page_token || tokens.has(data.page_token)) throw new FeishuReactionError();
      token = data.page_token; tokens.add(token);
    }
    throw new FeishuReactionError();
  }

  private authorize(): void { this.signal.throwIfAborted(); this.input.authorize(); }

  private async accessToken(): Promise<string> {
    if (this.token) return this.token;
    await this.validate(tokenUrl); this.authorize();
    const credentials = this.input.credentials();
    if (credentials.appId !== this.input.appId) throw new FeishuReactionError(300_000);
    const response = await this.request(tokenUrl, { method: 'POST', redirect: 'error', signal: this.signal,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app_id: credentials.appId, app_secret: credentials.appSecret }) });
    this.checkResponse(response);
    this.token = tokenSchema.parse(await response.json()).tenant_access_token;
    return this.token;
  }

  private async call(url: string, method: string, body?: unknown): Promise<Response> {
    const token = await this.accessToken();
    await this.validate(url); this.authorize();
    const response = await this.request(url, { method, redirect: 'error', signal: this.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!(method === 'DELETE' && response.status === 404)) this.checkResponse(response);
    return response;
  }

  private checkResponse(response: Response): void {
    if (response.ok) return;
    const retry = response.headers.get('retry-after');
    const delay = retry ? (Number.isFinite(Number(retry)) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 30_000;
    throw new FeishuReactionError(Math.max(response.status === 403 ? 300_000 : 30_000,
      Number.isFinite(delay) ? delay : 30_000));
  }
}
