import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InMemorySessionManager } from '../src/services/session-manager.js';
import { dispatchSessionInput } from '../src/services/agent/platform-access.js';
import { PlatformNoEffectError } from '../src/services/platform-commands/errors.js';

async function fixture(readyAfter: number, revoke = false, revokeAfterStage = false, initialPane = '') {
  const state = { reads: 0, writes: 0, enters: 0, waits: 0, authorized: true, pane: initialPane };
  const manager = new InMemorySessionManager({
    async listSessions() { return []; }, async hasSession() { return true; },
    async createSession() {}, async killSession() {}, async capturePane() { return state.pane; },
    async inspectPane() {
      state.reads++;
      return { content: state.pane || (state.reads >= readyAfter ? '› Ask Codex to do anything' : 'Starting Codex…'), dead: false };
    },
    async stageProgrammaticInput(_name, data) { state.writes++; state.pane = `› ${data}`; if (revokeAfterStage) state.authorized = false; },
    async pressEnter() { state.enters++; state.pane = 'Working · esc to interrupt'; },
  }, undefined, undefined, {
    programmaticReadyTimeoutMs: 500,
    programmaticSubmitSettleMs: { codex: 0 },
    sleep: async () => { state.waits++; if (revoke) state.authorized = false; },
  });
  const session = await manager.createSession({ userId: 'ready-user', sessionId: 'ready-session',
    launchPlan: { command: 'codex', args: [], cwd: '/tmp', env: {}, secretEnvNames: [], credentialMode: 'host_environment' } });
  return { state, manager, session };
}

describe('programmatic CLI readiness', () => {
  it('returns an actionable native trust blocker without waiting, staging or pressing Enter', async () => {
    const { manager, session, state } = await fixture(1, false, false, 'Hooks need review\n2. Trust all and continue');
    await assert.rejects(dispatchSessionInput(manager, session.id, 'codex', 'Run the task'),
      error => error instanceof PlatformNoEffectError && error.message === 'PROGRAMMATIC_SUBMIT_NATIVE_APPROVAL_REQUIRED');
    assert.equal(state.writes, 0); assert.equal(state.enters, 0); assert.equal(state.waits, 0);
  });
  it('waits for startup without sending anything, then submits exactly once', async () => {
    const { manager, session, state } = await fixture(3);
    await dispatchSessionInput(manager, session.id, 'codex', 'Run the task');
    assert.equal(state.writes, 1);
    assert.equal(state.enters, 1);
    assert.ok(state.waits >= 2);
  });
  it('classifies readiness timeout as definitely not sent', async () => {
    const { manager, session, state } = await fixture(100);
    await assert.rejects(dispatchSessionInput(manager, session.id, 'codex', 'Run the task'),
      error => error instanceof PlatformNoEffectError && error.message === 'PROGRAMMATIC_SUBMIT_NOT_READY');
    assert.equal(state.writes, 0);
    assert.equal(state.enters, 0);
  });
  it('rechecks action authority during startup and stops before writing', async () => {
    const { manager, session, state } = await fixture(3, true);
    await assert.rejects(dispatchSessionInput(manager, session.id, 'codex', 'Run the task', {
      authorize() { if (!state.authorized) throw new Error('Grant revoked'); },
    }), error => error instanceof PlatformNoEffectError && error.message === 'Grant revoked');
    assert.equal(state.writes, 0);
  });
  it('never sends Enter or retries after authority is revoked following staging', async () => {
    const { manager, session, state } = await fixture(1, false, true);
    await assert.rejects(dispatchSessionInput(manager, session.id, 'codex', 'Run the task', {
      authorize() { if (!state.authorized) throw new Error('Grant revoked'); },
    }), /COPILOT_DELIVERY_UNCONFIRMED/);
    assert.equal(state.writes, 1);
    assert.equal(state.enters, 0);
  });
});
