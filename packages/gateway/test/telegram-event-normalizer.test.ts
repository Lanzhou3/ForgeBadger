import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeTelegramUpdate } from "../src/services/integrations/telegram-event-normalizer.js";
import type { TelegramBotIdentity } from "../src/services/integrations/telegram-bot-api.js";

const bot: TelegramBotIdentity = { id: 111, username: "forgebadger_bot", firstName: "FB" };
const anonymousBot: TelegramBotIdentity = { id: 111, username: null, firstName: "FB" };

function update(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    update_id: 42,
    message: {
      message_id: 7,
      text: "hello",
      from: { id: 555, is_bot: false },
      chat: { id: 777, type: "private" }
    },
    ...overrides
  };
}

describe("normalizeTelegramUpdate", () => {
  it("normalizes a private message to a p2p event", () => {
    const event = normalizeTelegramUpdate(update(), bot);
    assert.deepEqual(event, {
      kind: "message",
      eventId: "tg:42",
      messageId: "7",
      chatId: "777",
      chatType: "p2p",
      senderId: "555",
      text: "hello",
      mentionedBot: false
    });
  });

  it("treats a text_mention entity pointing at the bot as a mention", () => {
    const event = normalizeTelegramUpdate(update({
      message: {
        message_id: 8,
        text: "hi there",
        from: { id: 555 },
        chat: { id: 778, type: "group" },
        entities: [{ type: "text_mention", offset: 0, length: 2, user: { id: 111 } }]
      }
    }), bot);
    assert.equal(event?.chatType, "group");
    assert.equal(event?.mentionedBot, true);
  });

  it("treats a mention entity matching the bot username case-insensitively as a mention", () => {
    const event = normalizeTelegramUpdate(update({
      message: {
        message_id: 9,
        text: "ping @ForgeBadger_Bot now",
        from: { id: 555 },
        chat: { id: 778, type: "supergroup" },
        entities: [{ type: "mention", offset: 5, length: 16 }]
      }
    }), bot);
    assert.equal(event?.chatType, "group");
    assert.equal(event?.mentionedBot, true);
  });

  it("leaves an unmentioned group message flagged as not mentioned", () => {
    const event = normalizeTelegramUpdate(update({
      message: {
        message_id: 10,
        text: "hello everyone",
        from: { id: 555 },
        chat: { id: 778, type: "group" }
      }
    }), bot);
    assert.equal(event?.mentionedBot, false);
  });

  it("falls back to a username regex when no entities are present", () => {
    const event = normalizeTelegramUpdate(update({
      message: {
        message_id: 11,
        text: "hey @forgebadger_bot, status?",
        from: { id: 555 },
        chat: { id: 778, type: "group" }
      }
    }), bot);
    assert.equal(event?.mentionedBot, true);

    const unnamed = normalizeTelegramUpdate(update({
      message: {
        message_id: 12,
        text: "hey @forgebadger_bot, status?",
        from: { id: 555 },
        chat: { id: 778, type: "group" }
      }
    }), anonymousBot);
    assert.equal(unnamed?.mentionedBot, false);
  });

  it("ignores updates that are not plain human messages", () => {
    // edited_message / channel_post have no top-level `message` key.
    assert.equal(normalizeTelegramUpdate({ update_id: 50, edited_message: { message_id: 1 } }, bot), undefined);
    assert.equal(normalizeTelegramUpdate({ update_id: 51, channel_post: { message_id: 1 } }, bot), undefined);
    assert.equal(normalizeTelegramUpdate(update({
      message: { message_id: 2, text: "bot talk", from: { id: 222, is_bot: true }, chat: { id: 1, type: "private" } }
    }), bot), undefined);
    assert.equal(normalizeTelegramUpdate(update({
      message: { message_id: 3, text: "no sender", chat: { id: 1, type: "private" } }
    }), bot), undefined);
    assert.equal(normalizeTelegramUpdate(update({
      message: { message_id: 4, from: { id: 5 }, chat: { id: 1, type: "private" } }
    }), bot), undefined);
    assert.equal(normalizeTelegramUpdate(update({
      message: { message_id: 5, text: "", from: { id: 5 }, chat: { id: 1, type: "private" } }
    }), bot), undefined);
    assert.equal(normalizeTelegramUpdate(update({
      message: { message_id: 6, text: "x".repeat(32_001), from: { id: 5 }, chat: { id: 1, type: "private" } }
    }), bot), undefined);
    assert.equal(normalizeTelegramUpdate(update({
      message: { message_id: 7, text: "broadcast", from: { id: 5 }, chat: { id: 9, type: "channel" } }
    }), bot), undefined);
    assert.equal(normalizeTelegramUpdate(update({ update_id: "42" }), bot), undefined);
    assert.equal(normalizeTelegramUpdate(null, bot), undefined);
  });
});
