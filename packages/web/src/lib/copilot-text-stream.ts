/** Reconnect-safe provisional text; durable transcript replaces it on settlement. */
export class CopilotTextStream {
  private runId = '';
  private highestFence = 0;
  private steps = new Map<string, { fence: number; sequence: number; text: string; pending: Map<number,string> }>();
  clear() { this.runId = ''; this.highestFence = 0; this.steps.clear(); }
  accept(runId: string, frame: Record<string,unknown>): string | undefined {
    const {text_step_id:step,text_fence:fence,text_sequence:sequence,text_delta:text}=frame;
    if(typeof step!=='string'||typeof text!=='string'||typeof fence!=='number'||typeof sequence!=='number'
      ||!Number.isSafeInteger(fence)||!Number.isSafeInteger(sequence)||fence<1||sequence<1||text.length>4096) return undefined;
    if(this.runId!==runId){this.clear();this.runId=runId;}
    if(fence<this.highestFence) return undefined;
    this.highestFence=fence;
    const prior=this.steps.get(step);
    if(prior && fence<prior.fence) return undefined;
    const current=prior?.fence===fence ? prior : {fence,sequence:0,text:'',pending:new Map<number,string>()};
    this.steps.set(step,current);
    if(sequence<=current.sequence || sequence>current.sequence+64) return undefined;
    current.pending.set(sequence,text);
    while(current.pending.has(current.sequence+1)) {
      current.text+=current.pending.get(++current.sequence)!;current.pending.delete(current.sequence);
    }
    return [...this.steps.values()].map(value=>value.text).join('');
  }
}
