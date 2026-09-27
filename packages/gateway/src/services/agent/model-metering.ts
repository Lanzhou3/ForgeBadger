import { z } from 'zod';
import type { Database } from '../../db/types.js';
import type { LlmUsage } from './llm-response.js';
const price = z.number().finite().min(0).max(1_000_000)
  .refine(value => Math.abs(value * 1_000_000 - Math.round(value * 1_000_000)) < 0.001, 'At most six decimal places');
export const tokenRatesSchema = z.object({ inputUsdPerMillion: price, outputUsdPerMillion: price,
  cachedInputUsdPerMillion: price.optional(), cacheWriteUsdPerMillion: price.optional() }).strict();
export type TokenRates = z.infer<typeof tokenRatesSchema>;

export class CopilotTokenRates {
  constructor(private db: Database, private userId: string) {}
  private assertModel(modelId: string) {
    if (!this.db.prepare('SELECT 1 FROM model_profiles WHERE user_id=? AND id=?').get(this.userId, modelId)) throw new Error('MODEL_NOT_FOUND');
  }
  get(modelId: string): TokenRates | null {
    this.assertModel(modelId);
    const row = this.db.prepare('SELECT rates_json FROM copilot_token_rates WHERE user_id=? AND model_profile_id=?').get(this.userId, modelId) as {rates_json:string}|undefined;
    return row ? tokenRatesSchema.parse(JSON.parse(row.rates_json)) : null;
  }
  set(modelId: string, value: unknown): TokenRates {
    this.assertModel(modelId);const rates=tokenRatesSchema.parse(value);
    this.db.prepare('INSERT INTO copilot_token_rates(user_id,model_profile_id,rates_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,model_profile_id) DO UPDATE SET rates_json=excluded.rates_json,updated_at=excluded.updated_at')
      .run(this.userId,modelId,JSON.stringify(rates),Date.now());return rates;
  }
}

export function reportedTokens(usage: LlmUsage | undefined): number | undefined {
  if (!usage) return undefined;
  if (Object.values(usage).some(value => !Number.isSafeInteger(value) || value < 0)) return undefined;
  if (usage.inputTokens !== undefined && usage.outputTokens !== undefined && usage.totalTokens !== undefined
    && usage.totalTokens !== usage.inputTokens + usage.outputTokens) return undefined;
  const total=usage.totalTokens ?? (usage.inputTokens !== undefined && usage.outputTokens !== undefined ? usage.inputTokens+usage.outputTokens : undefined);
  return Number.isSafeInteger(total) ? total : undefined;
}

/** Cache/reasoning are subsets of normalized totals, never extra output charges.
 * Integer nano-USD arithmetic with rounding only once per call; not an invoice. */
export function modelCostNanoUsd(usage: LlmUsage | undefined, rates: TokenRates | null): number | null {
  if (!rates || reportedTokens(usage) === undefined || usage?.inputTokens === undefined || usage.outputTokens === undefined) return null;
  const cached=usage.cachedInputTokens??0,written=usage.cacheWriteInputTokens??0;
  if(cached+written>usage.inputTokens || (usage.reasoningTokens??0)>usage.outputTokens) return null;
  const categories: Array<[number,number|undefined]> = [[usage.inputTokens-cached-written,rates.inputUsdPerMillion],
    [usage.outputTokens,rates.outputUsdPerMillion],[cached,rates.cachedInputUsdPerMillion],[written,rates.cacheWriteUsdPerMillion]];
  let microRateTokens=0n;
  for(const [count,rate] of categories) {
    if(count===0)continue;if(rate===undefined)return null;
    microRateTokens+=BigInt(count)*BigInt(Math.round(rate*1_000_000));
  }
  const cost=(microRateTokens+999n)/1000n;
  return cost<=BigInt(Number.MAX_SAFE_INTEGER)?Number(cost):null;
}
