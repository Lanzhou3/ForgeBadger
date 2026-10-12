import assert from 'node:assert/strict';
import { it } from 'node:test';
import { fileURLToPath } from "node:url";
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { z } from 'zod';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { containsSensitiveAgentValue, redactAgentErrorMessage, redactAgentValue } from '../src/services/agent/redaction.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';

it('rejects secret-shaped model tool input before any durable tool plan or execution', async () => {
  const db = new Database(':memory:');
  try {
    migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
    const user = new UserRepository(db).create('sensitive-tool@test.dev', 'hash');
    const ledger = new CopilotRunLedger(db, user.id);
    const conversation = ledger.log.createConversation();
    let executions = 0;
    let turns = 0;
    const secretMarker = 'sk-FAKEFIXTURE123456';
    const orchestrator = createCopilotOrchestrator({ db, masterKey: 'a'.repeat(32),
      eventBus: new ForgeBadgerEventBus(),
      toolRegistry: createAgentToolRegistry([{ name: 'inspect_fixture', description: 'Read-only test tool',
        risk: 'read', requiresApproval: false, inputSchema: z.object({ note: z.string() }),
        async execute() { executions++; return { ok: true }; } }]),
      llm: { async stream({ onEvent }) {
        if (turns++ === 0) {
          onEvent({ type: 'tool_call', toolCall: { id: 'call_safe', name: 'inspect_fixture',
            arguments: JSON.stringify({ note: 'ordinary input' }) } });
          onEvent({ type: 'tool_call', toolCall: { id: 'call_secret', name: 'inspect_fixture',
            arguments: JSON.stringify({ note: secretMarker }) } });
          return { message: '' };
        }
        return { message: 'Completed.' };
      }, async summarize() { return ''; }, async generateTitle() { return ''; } },
    });
    await assert.rejects(orchestrator.runTurn({ userId: user.id, conversationId: conversation.id,
      userText: 'Inspect a synthetic fixture.' }), { code: 'COPILOT_SENSITIVE_TOOL_INPUT' });
    const run = ledger.log.listRuns(conversation.id)[0]!;
    assert.equal(run.status, 'failed');
    assert.equal(ledger.steps(run.id).find(step => step.kind === 'model')?.status, 'failed');
    assert.equal(executions, 0);
    assert.equal(ledger.steps(run.id).filter(step => step.kind === 'tool').length, 0);
    assert.equal(ledger.log.listMessages(conversation.id).some(message => message.kind === 'tool_call'), false);
    const persisted = JSON.stringify({ steps: ledger.steps(run.id), messages: ledger.log.listMessages(conversation.id) });
    assert.equal(persisted.includes(secretMarker), false);
  } finally { db.close(); }
});

it('rejects credential-shaped tool names before writing a tool step', async () => {
  const db = new Database(':memory:');
  try {
    migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
    const user = new UserRepository(db).create('sensitive-name@test.dev', 'hash');
    const ledger = new CopilotRunLedger(db, user.id);
    const conversation = ledger.log.createConversation();
    const marker = 'sk-FAKETOOLNAME123456';
    const orchestrator = createCopilotOrchestrator({ db, masterKey: 'a'.repeat(32),
      eventBus: new ForgeBadgerEventBus(), toolRegistry: createAgentToolRegistry([]),
      llm: { async stream({ onEvent }) {
        onEvent({ type: 'tool_call', toolCall: { id: 'safe-id', name: marker, arguments: '{}' } });
        return { message: '' };
      }, async summarize() { return ''; }, async generateTitle() { return ''; } }
    });
    await assert.rejects(orchestrator.runTurn({ userId: user.id, conversationId: conversation.id,
      userText: 'Synthetic tool name fixture.' }), { code: 'COPILOT_SENSITIVE_TOOL_INPUT' });
    const run = ledger.log.listRuns(conversation.id)[0]!;
    assert.equal(ledger.steps(run.id).find(step => step.kind === 'model')?.status, 'failed');
    assert.equal(JSON.stringify(ledger.steps(run.id)).includes(marker), false);
  } finally { db.close(); }
});

it('rejects ordinary credential values in nested tool argument fields and JSON strings', async () => {
  for (const input of [
    { payload: { api_key: 'plainSecretValue123' } },
    { payload: '{"accessToken":"plainSecretValue123"}' },
    { payload: JSON.stringify(JSON.stringify({ api_key: 'plainSecretValue123' })) },
    { payload: { sessionToken: 'plainSecretValue123' } },
    { payload: { jwtSecret: 'plainSecretValue123' } }
  ]) {
    const db = new Database(':memory:');
    try {
      migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
      const user = new UserRepository(db).create('sensitive-field@test.dev', 'hash');
      const ledger = new CopilotRunLedger(db, user.id);
      const conversation = ledger.log.createConversation();
      const orchestrator = createCopilotOrchestrator({ db, masterKey: 'a'.repeat(32),
        eventBus: new ForgeBadgerEventBus(), toolRegistry: createAgentToolRegistry([]),
        llm: { async stream({ onEvent }) {
          onEvent({ type: 'tool_call', toolCall: { id: 'call-1', name: 'unknown_tool',
            arguments: JSON.stringify(input) } });
          return { message: '' };
        }, async summarize() { return ''; }, async generateTitle() { return ''; } }
      });
      await assert.rejects(orchestrator.runTurn({ userId: user.id, conversationId: conversation.id,
        userText: 'Synthetic credential field fixture.' }), { code: 'COPILOT_SENSITIVE_TOOL_INPUT' });
      const run = ledger.log.listRuns(conversation.id)[0]!;
      assert.equal(ledger.steps(run.id).filter(step => step.kind === 'tool').length, 0);
      assert.equal(JSON.stringify(ledger.log.listMessages(conversation.id)).includes('plainSecretValue123'), false);
    } finally { db.close(); }
  }
});

it('allows code text with a token variable and no embedded credential', () => {
  assert.equal(containsSensitiveAgentValue({ content: 'const token = signJwt(user)' }), false);
});

it('redacts full quoted credential values without treating code assignments as secrets', () => {
  const source = 'PASSWORD="plain demo secret" AWS_SECRET_ACCESS_KEY="plain demo aws" {"access_token":"plain demo token"}';
  const redacted = redactAgentErrorMessage(source);
  assert.equal(redacted.includes('plain demo'), false);
  assert.equal(redacted.includes('demo secret'), false);
  assert.equal(redacted.includes('demo token'), false);
  assert.equal(redacted.includes('demo aws'), false);
  assert.match(redacted, /"access_token":"\[REDACTED\]"/);
  assert.equal(containsSensitiveAgentValue({ content: 'const token = signJwt(user)' }), false);
});

it('preserves JSON syntax while redacting spaced access tokens in errors', () => {
  const redacted = redactAgentErrorMessage('{"access_token":"plain demo token"}');
  assert.deepEqual(JSON.parse(redacted), { access_token: '[REDACTED]' });
});

it('redacts unquoted provider environment credentials with spaces around equals', () => {
  const source = 'FORGEBADGER_MASTER_KEY = plain-master-value OPENAI_API_KEY = plain-openai-value FORGEBADGER_ATTACH_TOKEN = plain-attach-value';
  const redacted = redactAgentErrorMessage(source);
  assert.equal(redacted.includes('plain-'), false);
  assert.equal(containsSensitiveAgentValue({ content: source }), true);
  assert.equal(containsSensitiveAgentValue({ content: 'const token = signJwt(user)' }), false);
});

it('allows ordinary code references in object credential-like fields', () => {
  assert.equal(containsSensitiveAgentValue({ content: 'const config = { token: process.env.TOKEN }' }), false);
  assert.equal(containsSensitiveAgentValue({ content: 'const config = { password: passwordInput }' }), false);
  assert.equal(containsSensitiveAgentValue({ content: 'const config = { apiKey: process.env.OPENAI_API_KEY }' }), false);
  assert.equal(containsSensitiveAgentValue({ content: 'const config = { token: jwt, password: pw, apiKey: key }' }), false);
});

it('redacts unquoted password and token literals in terminal output', () => {
  assert.deepEqual(redactAgentValue({ pane: 'password: plain-demo-secret token: plain-demo-token\npassword: secret123 token: abc123' }), {
    pane: 'password: [REDACTED]\npassword: [REDACTED]'
  });
});

it('redacts terminal output that stops inside a quoted credential', () => {
  const output = redactAgentValue({ pane: 'OPENAI_API_KEY="plain-secret\n{"password":"plain-secret' });
  assert.deepEqual(output, { pane: 'OPENAI_API_KEY="[REDACTED]' });
});

it('redacts earlier credentials before truncating an open quoted value', () => {
  const output = redactAgentValue({ pane: 'OPENAI_API_KEY=plain-first-secret\nBearer plainBearerToken123\npassword="unfinished-secret' });
  assert.deepEqual(output, { pane: 'OPENAI_API_KEY=[REDACTED]\nBearer [REDACTED]\npassword="[REDACTED]' });
});

it('redacts the complete line of an unquoted multiword credential', () => {
  const output = redactAgentValue({ pane: 'password: plain demo secret\ntoken: plain demo token\nOPENAI_API_KEY=plain demo secret' });
  assert.deepEqual(output, { pane: 'password: [REDACTED]\ntoken: [REDACTED]\nOPENAI_API_KEY=[REDACTED]' });
  assert.equal(containsSensitiveAgentValue({ content: 'password: plain demo secret' }), true);
});

it('redacts JSON credentials embedded in tool error messages', () => {
  const message = 'upstream failed: {"password":"plain-demo-password","api_key":"plain-demo-key"}';
  const redacted = redactAgentErrorMessage(message);
  assert.equal(redacted.includes('plain-demo-'), false);
  assert.match(redacted, /\[REDACTED\]/);
});

it('does not broadcast a secret split across model text deltas', async () => {
  const db = new Database(':memory:');
  try {
    migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
    const user = new UserRepository(db).create('sensitive-stream@test.dev', 'hash');
    const ledger = new CopilotRunLedger(db, user.id);
    const conversation = ledger.log.createConversation();
    const eventBus = new ForgeBadgerEventBus();
    const events: unknown[] = [];
    eventBus.on('event', event => events.push(event));
    const marker = 'sk-FAKESTREAMSECRET123456';
    const orchestrator = createCopilotOrchestrator({ db, masterKey: 'a'.repeat(32), eventBus,
      toolRegistry: createAgentToolRegistry([]),
      llm: { async stream({ onEvent }) {
        onEvent({ type: 'text_delta', text: 'Here is sk-FAKE' });
        onEvent({ type: 'text_delta', text: 'STREAMSECRET123456 for you.' });
        return { message: `Here is ${marker} for you.` };
      }, async summarize() { return ''; }, async generateTitle() { return ''; } }
    });
    await orchestrator.runTurn({ userId: user.id, conversationId: conversation.id,
      userText: 'Synthetic text fixture.' });
    assert.equal(JSON.stringify(events).includes(marker), false);
    assert.equal(JSON.stringify(events).includes('sk-FAKE'), false);
    assert.match(JSON.stringify(events), /\[REDACTED\]/);
    assert.equal(JSON.stringify(ledger.log.listMessages(conversation.id)).includes(marker), false);
  } finally { db.close(); }
});

it('redacts a model-generated conversation title before storage and broadcast', async () => {
  const db = new Database(':memory:');
  try {
    migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
    const user = new UserRepository(db).create('sensitive-title@test.dev', 'hash');
    const ledger = new CopilotRunLedger(db, user.id);
    const conversation = ledger.log.createConversation();
    const eventBus = new ForgeBadgerEventBus();
    const events: unknown[] = [];
    eventBus.on('event', event => events.push(event));
    const marker = 'sk-FAKETITLESECRET123456';
    const orchestrator = createCopilotOrchestrator({ db, masterKey: 'a'.repeat(32), eventBus,
      toolRegistry: createAgentToolRegistry([]),
      llm: { async stream() { return { message: 'A safe response.' }; },
        async summarize() { return ''; }, async generateTitle() { return `Title ${marker}`; } }
    });
    await orchestrator.runTurn({ userId: user.id, conversationId: conversation.id,
      userText: 'Synthetic title fixture.' });
    assert.equal(ledger.log.getConversation(conversation.id)?.title?.includes(marker), false);
    assert.equal(JSON.stringify(events).includes(marker), false);
    assert.match(ledger.log.getConversation(conversation.id)?.title ?? '', /\[REDACTED\]/);
  } finally { db.close(); }
});
