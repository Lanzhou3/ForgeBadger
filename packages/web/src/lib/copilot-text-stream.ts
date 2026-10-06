export interface CopilotProvisionalText {
  steps: Array<{ stepId: string; fence: number; sequence: number; text: string }>;
}
interface TextStep {
  fence: number;
  sequence: number;
  highestSeen: number;
  text: string;
  pending: Map<number, string>;
}

/** Reconnect-safe provisional text; durable transcript replaces it on settlement. */
export class CopilotTextStream {
  private runId = '';
  private highestFence = 0;
  private steps = new Map<string, TextStep>();

  clear() { this.runId = ''; this.highestFence = 0; this.steps.clear(); }

  accept(runId: string, frame: Record<string, unknown>): string | undefined {
    const { text_step_id: step, text_fence: fence, text_sequence: sequence, text_delta: text } = frame;
    if (typeof step !== 'string' || typeof text !== 'string' || typeof sequence !== 'number' || !validCursor(fence, sequence) || text.length > 4096) return undefined;
    this.selectRun(runId);
    if (fence < this.highestFence) return undefined;
    this.highestFence = fence;
    const prior = this.steps.get(step);
    if (prior && fence < prior.fence) return undefined;
    const current = prior?.fence === fence ? prior : { fence, sequence: 0, highestSeen: 0, text: '', pending: new Map<number, string>() };
    this.steps.set(step, current);
    if (sequence <= current.sequence) return undefined;
    current.highestSeen = Math.max(current.highestSeen, sequence);
    if (sequence > current.sequence + 64) return undefined;
    current.pending.set(sequence, text);
    this.drain(current);
    return this.text();
  }

  /** Cumulative safe server text can fill a gap; older snapshots cannot rewind it. */
  restore(runId: string, snapshot: CopilotProvisionalText): string {
    this.selectRun(runId);
    if (!Array.isArray(snapshot.steps) || snapshot.steps.length > 256) return this.text();
    const valid = snapshot.steps.filter(step => typeof step.stepId === 'string' && typeof step.text === 'string'
      && step.text.length <= 1_048_576 && validCursor(step.fence, step.sequence));
    if (Math.max(0, ...valid.map(step => step.fence)) < this.highestFence) return this.text();
    const snapshotIds = new Set(valid.map(step => step.stepId));
    const complete = [...this.steps.keys()].every(step => snapshotIds.has(step));
    // Partial snapshots update cursors in place. Only a full snapshot knows
    // enough chronology to reorder all locally observed model steps.
    const updated = new Map(this.steps);
    for (const step of valid) {
      const prior = this.steps.get(step.stepId);
      if (prior && (step.fence < prior.fence || (step.fence === prior.fence && step.sequence < prior.sequence))) {
        continue;
      }
      const pending = prior?.fence === step.fence ? prior.pending : new Map<number, string>();
      for (const sequence of pending.keys()) if (sequence <= step.sequence) pending.delete(sequence);
      const current = { ...step, highestSeen: Math.max(step.sequence, prior?.fence === step.fence ? prior.highestSeen : 0), pending };
      this.drain(current);
      updated.set(step.stepId, current);
      this.highestFence = Math.max(this.highestFence, step.fence);
    }
    this.steps = complete ? new Map(valid.map(step => [step.stepId, updated.get(step.stepId)!])) : updated;
    return this.text();
  }

  gapKey(): string {
    return [...this.steps].filter(([, step]) => step.highestSeen > step.sequence)
      .map(([id, step]) => `${id}:${step.fence}:${step.sequence}`).join('|');
  }

  private selectRun(runId: string) { if (this.runId !== runId) { this.clear(); this.runId = runId; } }
  private text() { return [...this.steps.values()].map(step => step.text).join(''); }
  private drain(step: TextStep) {
    while (step.pending.has(step.sequence + 1)) {
      step.text += step.pending.get(++step.sequence)!;
      step.pending.delete(step.sequence);
    }
  }
}
function validCursor(fence: unknown, sequence: unknown): fence is number {
  return typeof fence === 'number' && typeof sequence === 'number'
    && Number.isSafeInteger(fence) && Number.isSafeInteger(sequence) && fence >= 1 && sequence >= 1;
}
