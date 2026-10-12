import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createSecurityPolicy } from '../src/services/agent/security-policy.js';
import { containsSensitiveAgentValue, redactAgentText, redactAgentValue } from '../src/services/agent/redaction.js';
import { PublicTextStream } from '../src/services/agent/public-text-stream.js';

it('scans actual terminal scripts regardless of Markdown indentation', () => {
  const policy = createSecurityPolicy();
  for (const prefix of ['', '    ', '\t', '\n    ']) {
    const decision = policy.evaluate({ userId: 'fixture', toolName: 'terminal_run', toolRisk: 'operate', requiresApproval: true,
      input: { projectId: 'fixture', command: prefix + 'rm -rf /tmp/synthetic-fixture' } });
    assert.equal(decision.action, 'deny');
  }
});

it('redacts private key blocks from structured tool output and detects sensitive input', () => {
  for (const label of ['PRIVATE KEY', 'RSA PRIVATE KEY', 'EC PRIVATE KEY', 'ENCRYPTED PRIVATE KEY', 'OPENSSH PRIVATE KEY']) {
    const pem = `-----BEGIN ${label}-----\nSYNTHETIC_BODY_NOT_A_KEY\n-----END ${label}-----`;
    assert.equal(containsSensitiveAgentValue({ text: pem }), true);
    assert.equal(JSON.stringify(redactAgentValue({ text: pem })).includes('SYNTHETIC_BODY'), false);
    assert.equal(redactAgentText(pem + '\npublic').endsWith('\npublic'), true);
  }
});

it('does not emit private key body when the introducer is split across streaming chunks', () => {
  const emitted: string[] = [];
  const stream = new PublicTextStream(text => emitted.push(text));
  for (const chunk of ['Safe preface.\n-----BE', 'GIN RSA ', 'PRIVATE KEY-----\n', 'SYNTHETIC_BODY_NOT_A_KEY\n', '-----END RSA PRIVATE KEY-----']) stream.push(chunk);
  stream.finish();
  assert.equal(emitted.join('').includes('SYNTHETIC_BODY'), false);
});
