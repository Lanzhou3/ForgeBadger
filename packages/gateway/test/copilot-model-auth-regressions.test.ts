import assert from 'node:assert/strict';
import { it } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { ModelProviderRepository } from '../src/db/repositories/model-provider-repository.js';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { createAgentLlmClient } from '../src/services/agent/llm-client.js';

it('supports credential-free transports and observes configuration/credential changes within a client', async () => {
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  try {
    const user = new UserRepository(db).create('auth-fixture@test.invalid', 'fixture');
    const repo = new ModelProviderRepository(db, user.id, 'a'.repeat(32));
    const provider = repo.createProviderProfile({ name: 'Fixture', providerKey: 'fixture', baseUrl: 'https://before.example', authType: 'none', apiFormat: 'local', supportedAdapters: ['pi'] });
    const model = repo.createModelProfile({ providerProfileId: provider.id, name: 'Fixture', modelId: 'before', capabilities: ['chat'] });
    const calls: { url: string; model: string; headers: Headers }[] = [];
    const client = createAgentLlmClient({ modelProviderRepository: repo, resolveHost: async () => [{ address: '8.8.8.8', family: 4 }],
      fetchImpl: async (url, init) => { calls.push({ url: String(url), model: JSON.parse(String(init?.body)).model, headers: new Headers(init?.headers) });
        return String(url).endsWith('/v1/messages')
          ? Response.json({ content: [{ type: 'text', text: 'Fixture.' }], stop_reason: 'end_turn' })
          : Response.json({ choices: [{ message: { role: 'assistant', content: 'Fixture.' }, finish_reason: 'stop' }] }); } });
    const request = { modelId: model.id, messages: [{ role: 'user' as const, content: 'Fixture.' }], tools: [], onEvent() {} };
    await client.stream(request);
    assert.equal(calls[0]!.headers.has('authorization'), false);
    const credential = repo.createCredential({ providerProfileId: provider.id, plaintextSecret: 'synthetic-before' });
    repo.updateProviderProfile(provider.id, { authType: 'api_key' });
    await client.stream(request);
    repo.rotateCredential(credential.id, { plaintextSecret: 'synthetic-after' });
    repo.updateProviderProfile(provider.id, { baseUrl: 'https://after.example' });
    repo.updateModelProfile(model.id, { modelId: 'after' });
    await client.stream(request);
    assert.equal(calls[1]!.headers.get('authorization'), 'Bearer synthetic-before');
    assert.equal(calls[2]!.headers.get('authorization'), 'Bearer synthetic-after');
    assert.equal(calls[2]!.model, 'after');
    assert.equal(calls[2]!.url.startsWith('https://after.example'), true);
    repo.updateProviderProfile(provider.id, { apiFormat: 'anthropic', authType: 'none' });
    await client.stream(request);
    assert.equal(calls[3]!.headers.has('x-api-key'), false);
    assert.equal(calls[3]!.headers.has('authorization'), false);
  } finally { db.close(); }
});
