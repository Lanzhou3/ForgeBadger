import assert from 'node:assert/strict';
import { it } from 'node:test';
import { InMemorySessionManager } from '../src/services/session-manager.js';
import { dispatchSessionInput } from '../src/services/agent/platform-access.js';

const message = Array.from({ length: 35 }, (_, i) => `review line ${i}`).join('\n');
const ready = '──────\n❯\n──────';
const folded = '──────\n❯ [Pasted text #1 +34 lines]\n──────';

for (const mode of ['normal', 'draft', 'mismatched', 'revoked'] as const) {
  it(`Claude folded task dispatch: ${mode}`, async () => {
    let pane = mode === 'draft' ? '──────\n❯\nexisting draft\n──────' : ready;
    let authorized = true;
    const writes: string[] = [];
    const manager = new InMemorySessionManager({
      async listSessions() { return []; }, async hasSession() { return true; },
      async createSession() {}, async killSession() {}, async capturePane() { return pane; },
      async inspectPane() { return { content: pane, dead: false }; },
      async stageProgrammaticInput(_name, text) {
        writes.push(text); pane = mode === 'mismatched' ? folded.replace('+34', '+33') : folded;
        if (mode === 'revoked') authorized = false;
      },
      async pressEnter() { writes.push('ENTER'); pane = ready; },
    }, undefined, undefined, { programmaticReadyTimeoutMs: 1,
      programmaticSubmitSettleMs: { claude: 0 }, sleep: async () => {} });
    const session = await manager.createSession({ userId: 'user', sessionId: `claude-${mode}`,
      launchPlan: { command: 'claude', args: [], cwd: '/tmp', env: {}, secretEnvNames: [] } });
    const dispatch = () => dispatchSessionInput(manager, session.id, 'claude', message,
      { authorize() { if (!authorized) throw new Error('revoked'); } });
    if (mode === 'normal') {
      assert.deepEqual(await dispatch(), { dispatched: true, sessionId: session.id, delivery: 'consumed' });
      assert.deepEqual(writes, [message, 'ENTER']);
    } else {
      await assert.rejects(dispatch(), new RegExp(mode === 'draft' ? 'PROGRAMMATIC_SUBMIT_NOT_READY' : 'COPILOT_DELIVERY_UNCONFIRMED'));
      assert.deepEqual(writes, mode === 'draft' ? [] : [message]);
    }
  });
}
