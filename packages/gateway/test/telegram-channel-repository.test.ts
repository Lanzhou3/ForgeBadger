import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { TelegramChannelRepository } from '../src/db/repositories/telegram-channel-repository.js';
import { TelegramIntegrationRepository } from '../src/db/repositories/telegram-integration-repository.js';
import { UserRepository, type User } from '../src/db/repositories/user-repository.js';

const masterKey = '0123456789abcdef0123456789abcdef';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/db/migrations')
  });
  return db;
}

describe('TelegramChannelRepository', () => {
  let db: Database.Database;
  let owner: User;
  let other: User;
  let repo: TelegramChannelRepository;
  let otherRepo: TelegramChannelRepository;

  beforeEach(() => {
    db = createTestDb();
    const users = new UserRepository(db);
    owner = users.create('telegram-owner@example.com', 'hash');
    other = users.create('telegram-other@example.com', 'hash');
    repo = new TelegramChannelRepository(db, owner.id, masterKey);
    otherRepo = new TelegramChannelRepository(db, other.id, masterKey);
  });

  it('stores the bot token encrypted, tenant scoped, and round-trips decryption', () => {
    const account = repo.upsertAccount({ botToken: '110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw', botUsername: 'forgebadger_bot', enabled: true });

    assert.equal(account.secretConfigured, true);
    assert.equal('botToken' in account, false);
    assert.equal(account.botUsername, 'forgebadger_bot');
    assert.equal(account.connectionState, 'pending');
    assert.equal(otherRepo.getAccount(account.id), undefined);
    assert.deepEqual(repo.decryptAccountCredentials(account.id), { botToken: '110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw' });

    const stored = db.prepare('SELECT bot_token_encrypted FROM telegram_channel_accounts WHERE id = ?').get(account.id) as { bot_token_encrypted: string };
    assert.doesNotMatch(stored.bot_token_encrypted, /AAHdqTcv/);
  });

  it('requires a bot token for the initial upsert and bumps config revision on every save', () => {
    assert.throws(() => repo.upsertAccount({ enabled: true }), /TELEGRAM_BOT_TOKEN_REQUIRED/);
    const first = repo.upsertAccount({ botToken: 'token-one', enabled: true });
    assert.equal(first.configRevision, 1);
    const second = repo.upsertAccount({ enabled: true });
    assert.equal(second.configRevision, 2);
    assert.equal(second.secretConfigured, true);
    assert.deepEqual(repo.decryptAccountCredentials(second.id), { botToken: 'token-one' });
    const third = repo.upsertAccount({ botToken: 'token-two', enabled: false });
    assert.equal(third.configRevision, 3);
    assert.equal(third.enabled, false);
    assert.equal(third.connectionState, 'disabled');
    assert.deepEqual(repo.decryptAccountCredentials(third.id), { botToken: 'token-two' });
  });

  it('preserves bot username unless a new getMe result is supplied', () => {
    const account = repo.upsertAccount({ botToken: 'token', botUsername: 'old_bot', enabled: true });
    const kept = repo.upsertAccount({ enabled: true });
    assert.equal(kept.botUsername, 'old_bot');
    const updated = repo.upsertAccount({ botUsername: 'new_bot', enabled: true });
    assert.equal(updated.botUsername, 'new_bot');
    assert.equal(repo.getAccount(account.id)?.botUsername, 'new_bot');
  });

  it('records connection health without touching the config revision', () => {
    const account = repo.upsertAccount({ botToken: 'token', enabled: true });
    const when = new Date('2026-01-02T03:04:05Z');
    const healthy = repo.updateAccountHealth(account.id, { state: 'connected', lastConnectedAt: when });
    assert.equal(healthy.connectionState, 'connected');
    assert.equal(healthy.lastConnectedAt?.toISOString(), '2026-01-02T03:04:05.000Z');
    assert.equal(healthy.configRevision, account.configRevision);

    const unhealthy = repo.updateAccountHealth(account.id, { state: 'unhealthy', errorCode: 'TELEGRAM_TOKEN_INVALID', errorMessage: '401 Unauthorized' });
    assert.equal(unhealthy.connectionState, 'unhealthy');
    assert.equal(unhealthy.lastErrorCode, 'TELEGRAM_TOKEN_INVALID');
    assert.equal(unhealthy.lastErrorMessage, '401 Unauthorized');
    assert.throws(() => repo.updateAccountHealth('missing', { state: 'connected' }), /TELEGRAM_ACCOUNT_NOT_FOUND/);
    assert.equal(otherRepo.getAccount(account.id), undefined);
  });
});

describe('TelegramIntegrationRepository', () => {
  let db: Database.Database;
  let owner: User;
  let repo: TelegramIntegrationRepository;

  beforeEach(() => {
    db = createTestDb();
    owner = new UserRepository(db).create('telegram-config@example.com', 'hash');
    repo = new TelegramIntegrationRepository(db, owner.id);
  });

  it('defaults to disabled with an empty group allowlist', () => {
    const config = repo.getConfig();
    assert.deepEqual(config, { enabled: false, emergencyDisabled: false, allowedChatIds: [] });
    assert.equal(repo.canExecuteActions(), false);
  });

  it('upserts config fields and normalizes the group allowlist', () => {
    const config = repo.upsertConfig({ enabled: true, allowedChatIds: ['-1001', ' -1002 ', '-1001', ''] });
    assert.deepEqual(config, { enabled: true, emergencyDisabled: false, allowedChatIds: ['-1001', '-1002'] });
    assert.equal(repo.canExecuteActions(), true);

    const partial = repo.upsertConfig({ emergencyDisabled: true });
    assert.deepEqual(partial.allowedChatIds, ['-1001', '-1002']);
    assert.equal(partial.emergencyDisabled, true);
    assert.equal(repo.canExecuteActions(), false);

    assert.throws(() => repo.upsertConfig({ allowedChatIds: Array.from({ length: 51 }, (_, i) => `chat-${i}`) }), /cannot exceed/);
    assert.throws(() => repo.upsertConfig({ allowedChatIds: ['x'.repeat(129)] }), /128 characters/);
  });
});
