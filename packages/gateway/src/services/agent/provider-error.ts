import { AgentError } from './types.js';
import { withAbort } from './llm-response.js';

/** Read only a bounded structured rejection. Provider bodies may contain secrets;
 * classification never copies them into errors, logs, receipts or prompts. */
export async function providerRejection(response: Response, signal: AbortSignal): Promise<AgentError> {
  const fallback = new AgentError('AGENT_HTTP_ERROR', `Provider returned HTTP ${response.status}`);
  if (![400,413].includes(response.status) || !response.body) {
    void response.body?.cancel().catch(()=>undefined);
    return fallback;
  }
  const reader = response.body.getReader();
  let bytes = 0, text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const item = await withAbort(reader.read(), signal);
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > 8192) return fallback;
      text += decoder.decode(item.value,{stream:true});
    }
    const body:unknown = JSON.parse(text + decoder.decode());
    if (!body || typeof body !== 'object' || !('error' in body)) return fallback;
    const error = body.error;
    if (!error || typeof error !== 'object') return fallback;
    const value = error as Record<string,unknown>;
    const knownCode = value.code === 'context_length_exceeded' || value.type === 'context_length_exceeded';
    const knownMessage = value.type === 'invalid_request_error' && typeof value.message === 'string'
      && /^prompt is too long: \d+ tokens > \d+ maximum\b/iu.test(value.message);
    return knownCode || knownMessage
      ? new AgentError('AGENT_CONTEXT_OVERFLOW','Provider rejected the request because its context window was exceeded') : fallback;
  } catch (error) {
    signal.throwIfAborted();
    return fallback;
  } finally {
    void reader.cancel().catch(()=>undefined);
    reader.releaseLock();
  }
}
