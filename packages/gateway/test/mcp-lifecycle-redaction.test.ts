import assert from 'node:assert/strict';
import { test } from 'node:test';
import { containsSensitiveAgentValue, redactAgentText, redactAgentValue } from '../src/services/agent/redaction.js';

test('task-packet identifiers and URLs survive MCP redaction and input admission', () => {
  for (const value of ['task-packet', 'task-packet-123', '/api/v1/task-packets', 'https://example.test/task-packet/123']) {
    assert.equal(redactAgentText(value), value);
    assert.deepEqual(redactAgentValue({ ref: value }), { ref: value });
    assert.equal(containsSensitiveAgentValue({ ref: value }), false);
  }
});

test('standalone provider keys remain masked at punctuation and assignment boundaries', () => {
  for (const value of ['sk-fictional123', '"sk-fictional123"', 'key=sk-fictional123', '(sk-fictional123)', 'Bearer sk-fictional123',
    'Bash-sk-fictional123', 'prefix_sk-fictional123', 'prefix:sk-fictional123', 'task-packet-sk-fictional123']) {
    assert.doesNotMatch(redactAgentText(value), /sk-fictional123/);
    assert.equal(containsSensitiveAgentValue(value), true);
  }
});
