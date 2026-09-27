import type { AgentLlmClient, AgentLlmStreamEvent, AgentLlmToolSchema } from './orchestrator-types.js';
import type { CompressedContext } from './context.js';
import type { CopilotRunLedger, Claim, RunStep } from './run-ledger.js';
import { AgentError } from './types.js';

export async function streamWithContextRecovery(input: {
  llm: AgentLlmClient; ledger: CopilotRunLedger; claim: Claim; step: RunStep;
  modelId?: string; signal: AbortSignal; live: () => boolean; tools: AgentLlmToolSchema[];
  buildContext: (recoveryBudget?: number) => Promise<CompressedContext>;
  onEvent: (event: AgentLlmStreamEvent) => void;
}) {
  let context = await input.buildContext();
  let acceptedOutput = false;
  const invoke = () => {
    input.signal.throwIfAborted();
    if (!input.live()) throw new AgentError('COPILOT_LEASE_LOST','Execution ownership changed');
    return input.llm.stream({messages:context.messages, tools:input.tools, signal:input.signal,
      ...(input.modelId ? {modelId:input.modelId} : {}), onEvent: event => {
        if (event.type === 'tool_call' || (event.type === 'text_delta' && event.text)) acceptedOutput = true;
        input.onEvent(event);
      }});
  };
  try { return await invoke(); }
  catch (error) {
    if (!(error instanceof AgentError) || error.code !== 'AGENT_CONTEXT_OVERFLOW' || acceptedOutput) throw error;
    input.signal.throwIfAborted();
    const before = JSON.stringify({messages:context.messages,tools:input.tools}).length;
    // A smaller application projection is a bounded recovery attempt, not a token estimate.
    const budget = Math.floor((before + 8192) * .6);
    if (!input.live() || !input.ledger.claimContextRecovery(input.claim,input.step.id,input.modelId,budget)) throw error;
    context = await input.buildContext(budget);
    if (JSON.stringify({messages:context.messages,tools:input.tools}).length >= before)
      throw new AgentError('COPILOT_CONTEXT_RECOVERY_NO_GAIN','Context cannot shrink while preserving the current goal and tool evidence');
    return await invoke(); // Deliberately outside any retry loop; a second rejection stops.
  }
}
