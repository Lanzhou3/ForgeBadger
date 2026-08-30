import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { FeishuChannelRepository } from "../src/db/repositories/feishu-channel-repository.js";
import { PortfolioFeishuRegistryRepository } from "../src/db/repositories/portfolio-feishu-registry-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { buildAgentStack, type AgentStackDeps } from "../src/services/agent/agent-stack.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";
import { createFeishuCopilotChannel } from "../src/services/integrations/feishu-copilot-channel.js";
import {
  buildCopilotRunCard,
  createFeishuOutboundTextScrubber,
  prepareFeishuCopilotText,
  sanitizeFeishuCopilotText
} from "../src/services/integrations/feishu-copilot-cards.js";

const masterKey = "0123456789abcdef0123456789abcdef";
const defaultReply = "来自 Copilot 的回复";

interface SentMessage { chatId: string; text: string }
interface SentCard { chatId: string; card: Record<string, unknown>; messageId?: string }
interface CardUpdate { messageId: string; card: Record<string, unknown> }

function createTestDb(): Database {
  const db = new Database(":memory:");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

function headerState(card: Record<string, unknown>): string | undefined {
  const header = card.header as { title?: { content?: string } } | undefined;
  return header?.title?.content;
}

function cardBody(card: Record<string, unknown>): string {
  const body = card.body as { elements?: Array<{ text?: { content?: string } }> } | undefined;
  return body?.elements?.map((element) => element.text?.content ?? "").join("\n") ?? "";
}

function buttonValues(card: Record<string, unknown>): Array<Record<string, unknown>> {
  const body = card.body as { elements?: unknown[] } | undefined;
  const rows = body?.elements ?? [];
  return rows
    .map((element) => element as { tag?: string; value?: Record<string, unknown> })
    .filter((element) => element.tag === "button")
    .map((element) => element.value ?? {});
}

function approvalValue(
  sentCards: SentCard[],
  decision: "approve" | "reject"
): Record<string, unknown> {
  const approvalCard = sentCards.find((entry) => headerState(entry.card) === "Copilot 请求审批");
  assert.ok(approvalCard, "expected an approval card");
  const value = buttonValues(approvalCard.card)
    .find((candidate) => candidate.copilot_decision === decision);
  assert.ok(value, `expected ${decision} button value`);
  return value;
}

describe("copilot channel streaming cards & approvals", () => {
  function setup(overrides: {
    cardSendFails?: boolean;
    cardUpdateFails?: boolean;
    assistantText?: string;
    streamDeltas?: string[];
    awaitingApproval?: boolean;
    approvalOutcome?: "completed" | "failed" | "cancelled" | "running";
    approvalInputJson?: string;
    approvalToolResult?: string;
    approvalRunError?: string;
    approvalSettleTimeoutMs?: number;
    approvalCardNoMessageId?: boolean;
  } = {}) {
    const db = new Database(":memory:");
    migrate(drizzle(db), {
      migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
    });
    const userId = new UserRepository(db).create("feishu-cards@example.com", "hash").id;
    new FeishuChannelRepository(db, userId, masterKey).upsertAccount({
      appId: "cli_cards_test", appSecret: "secret", enabled: true
    });
    const providerAccount = new PortfolioFeishuRegistryRepository(db)
      .register({ userId, provider: "feishu", providerAccountId: "cli_cards_test" });

    const eventBus = new ForgeBadgerEventBus();
    const turnCalls: Array<{ conversationId: string; userText: string }> = [];
    const resumeCalls: Array<{ runId: string; actionId: string; approved: boolean }> = [];
    let gate: ((value: unknown) => void) | null = null;
    let nextRunId = "";

    let holdResolve: (() => void) | null = null;
    let holdPromise: Promise<void> | null = null;

    const stackFactory = ((_deps: AgentStackDeps, uid: string) => {
      const log = new CopilotConversationLog(db, uid);
      return {
        log,
        memory: {},
        toolRegistry: { tools: new Map() },
        orchestrator: {
          async runTurn(input: { userId: string; conversationId: string; userText: string }) {
            turnCalls.push(input);
            log.appendMessage(input.conversationId, { role: "user", kind: "text", content: input.userText });
            const run = log.createRun(input.conversationId, {});
            nextRunId = run.id;
            if (holdPromise) {
              const held = holdPromise;
              holdPromise = null;
              await held;
            }
            if (overrides.awaitingApproval) {
              log.createPendingAction({
                runId: run.id,
                tool: "stub_operate_tool",
                inputJson: overrides.approvalInputJson ?? "{\"x\":1}",
                inputDigest: "digest"
              });
              log.updateRun(run.id, { status: "awaiting_approval" });
              return run.id;
            }
            const deltas = overrides.streamDeltas ?? (turnCalls.length === 2 ? ["流式增量"] : []);
            for (const textDelta of deltas) {
              // Emit a delta while the second turn is live so the stream layer
              // has something to flush into the card.
              eventBus.emitEvent({
                type: "copilot_run_updated",
                userId: uid,
                source: "user",
                runId: run.id,
                conversationId: input.conversationId,
                status: "running",
                textDelta,
                occurredAt: new Date()
              });
              await new Promise((resolve) => setTimeout(resolve, 1));
            }
            log.appendMessage(input.conversationId, {
              role: "assistant",
              kind: "text",
              content: overrides.assistantText ?? `${defaultReply}#${turnCalls.length}`
            });
            log.updateRun(run.id, { status: "completed", completedAt: new Date() });
            return run.id;
          },
          async resumeAfterApproval(input: { runId: string; actionId: string; approved: boolean }) {
            resumeCalls.push(input);
            const run = log.getRun(input.runId);
            const action = log.getPendingAction(input.actionId);
            if (!run || !action || action.status !== "pending") return { resumed: false, runId: input.runId };
            log.decidePendingAction(action.id, input.approved ? "approved" : "rejected");
            if (!input.approved) {
              log.updateRun(run.id, { status: "cancelled", completedAt: new Date() });
              return { resumed: true, runId: input.runId };
            }
            const outcome = overrides.approvalOutcome ?? "completed";
            if (outcome === "completed") {
              log.appendMessage(run.conversationId, {
                role: "tool",
                kind: "tool_result",
                content: overrides.approvalToolResult ?? "{\"ok\":true}",
                toolName: action.tool
              });
              log.updateRun(run.id, { status: "completed", completedAt: new Date() });
            } else if (outcome === "failed") {
              log.updateRun(run.id, { status: "failed", error: overrides.approvalRunError ?? "tool failed", completedAt: new Date() });
            } else if (outcome === "cancelled") {
              log.updateRun(run.id, { status: "cancelled", completedAt: new Date() });
            } else {
              log.updateRun(run.id, { status: "running" });
            }
            return { resumed: true, runId: input.runId };
          },
          async cancelRun() { return { cancelled: true, runId: "" }; }
        }
      };
    }) as unknown as typeof buildAgentStack;

    const sent: SentMessage[] = [];
    const sentCards: SentCard[] = [];
    const cardUpdates: CardUpdate[] = [];
    let failCardSend = overrides.cardSendFails === true;
    let failCardUpdate = overrides.cardUpdateFails === true;
    function armHold(): void {
      holdPromise = new Promise<void>((resolve) => { holdResolve = resolve; });
    }
    function releaseHold(): void {
      holdResolve?.();
    }

    const deps: AgentStackDeps = { db, masterKey, eventBus };
    const channel = createFeishuCopilotChannel({
      deps,
      buildAgentStack: stackFactory,
      sendMessage: async ({ chatId, text }) => { sent.push({ chatId, text }); },
      userId,
      providerAccountId: providerAccount.id,
      transport: "long_connection",
      cardTransport: {
        sendCard: async (chatId, card) => {
          if (failCardSend) throw new Error("card transport down");
          const messageId = `msg_${sentCards.length + 1}`;
          sentCards.push({ chatId, messageId, card: card as Record<string, unknown> });
          if (overrides.approvalCardNoMessageId && headerState(card as Record<string, unknown>) === "Copilot 请求审批") {
            return undefined;
          }
          return messageId;
        },
        updateCard: async (messageId, card) => {
          cardUpdates.push({ messageId, card: card as Record<string, unknown> });
          if (failCardUpdate) throw new Error("card update down");
        }
      },
      ...(overrides.approvalSettleTimeoutMs === undefined
        ? {}
        : { approvalSettleTimeoutMs: overrides.approvalSettleTimeoutMs })
    });

    async function deliver(text: string, chatId = "oc_chat"): Promise<void> {
      const ingress = {
        chatId,
        text,
        providerEventId: `evt_${Math.random().toString(36).slice(2)}`,
        senderIdentity: "ou_owner"
      };
      if (!channel.admitMessage(ingress)) return;
      await channel.processMessage(ingress);
    }

    function recordAwaiting(runId: string): { id: string; runId: string; inputJson: string } {
      return { id: `act_${runId}`, runId, inputJson: "{\"x\":1}" };
    }

    return {
      db,
      userId,
      eventBus,
      channel,
      sent,
      sentCards,
      cardUpdates,
      turnCalls,
      resumeCalls,
      deliver,
      armHold,
      releaseHold,
      mkIngress(text: string, chatId = "oc_chat") {
        return {
          chatId,
          text,
          providerEventId: `evt_${Math.random().toString(36).slice(2)}`,
          senderIdentity: "ou_owner"
        };
      },
      recordAwaiting,
      get nextRunIdRef() { return () => nextRunId; },
      setGate(fn: ((value: unknown) => void) | null) { gate = fn; },
      setFailCardSend(value: boolean) { failCardSend = value; },
      setFailCardUpdate(value: boolean) { failCardUpdate = value; },
      };
  }

  it("renders useful empty states, preserves schema 2.0, and caps the visible body at 6000 characters", () => {
    const running = buildCopilotRunCard({ state: "running", text: "" }) as Record<string, unknown>;
    const done = buildCopilotRunCard({ state: "done", text: "<think>only reasoning</think>" }) as Record<string, unknown>;
    const long = buildCopilotRunCard({ state: "done", text: "a".repeat(6_100) }) as Record<string, unknown>;

    assert.equal(running.schema, "2.0");
    assert.deepEqual(running.config, { update_multi: true });
    assert.equal(cardBody(running), "正在生成回复，请稍候…");
    assert.equal(cardBody(done), "已完成，但没有可展示的回复。");
    assert.ok(cardBody(long).length <= 6_000);
  });

  it("removes complete, repeated, unterminated, stray, and delta-split think markup", () => {
    assert.equal(sanitizeFeishuCopilotText("<think>秘密</think>公开"), "公开");
    assert.equal(
      sanitizeFeishuCopilotText("前言<think>秘密一</think>正文<think>秘密二</think>结尾"),
      "前言正文结尾"
    );
    assert.equal(sanitizeFeishuCopilotText("正文<think>未闭合秘密"), "正文");
    assert.equal(sanitizeFeishuCopilotText("正文</think>结尾"), "正文结尾");
    assert.equal(sanitizeFeishuCopilotText("<thi"), "");
    assert.equal(
      sanitizeFeishuCopilotText("<ThInK type=\"analysis\">属性秘密</THINK>公开"),
      "公开"
    );
    assert.equal(
      sanitizeFeishuCopilotText("&lt;think type=&quot;analysis&quot;&gt;实体秘密&lt;/think&gt;公开"),
      "公开"
    );
    assert.equal(sanitizeFeishuCopilotText("提醒<at id=all>所有人</at>公开"), "提醒所有人公开");
    assert.equal(sanitizeFeishuCopilotText("提醒&lt;at id=all&gt;所有人&lt;/at&gt;公开"), "提醒所有人公开");
    assert.equal(sanitizeFeishuCopilotText("&lt;thi"), "");
    assert.equal(sanitizeFeishuCopilotText("&lt;think type=&quot;analysis&quot;"), "");
  });

  it("removes every supported reasoning wrapper including attributes and encoded markup", () => {
    for (const tag of ["thinking", "reasoning", "thought", "REASONING_SCRATCHPAD"]) {
      assert.equal(
        sanitizeFeishuCopilotText(`<${tag} type="analysis">private chain</${tag}>visible`),
        "visible",
        tag
      );
    }
    assert.equal(
      sanitizeFeishuCopilotText("before&lt;ReAsOnInG mode=&quot;deep&quot;&gt;private&lt;/REASONING&gt;after"),
      "beforeafter"
    );
    assert.equal(sanitizeFeishuCopilotText("visible<reasoning>unfinished private"), "visible");
    assert.equal(sanitizeFeishuCopilotText("visible</thought>after"), "visibleafter");
    assert.equal(sanitizeFeishuCopilotText("<REASONING_SCR"), "");
  });

  it("removes model analysis blocks from Feishu-visible text", () => {
    assert.equal(sanitizeFeishuCopilotText("<analysis>private chain</analysis>visible"), "visible");
    assert.equal(
      sanitizeFeishuCopilotText('before<AnAlYsIs mode="deep">private</ANALYSIS>after'),
      "beforeafter"
    );
    assert.equal(
      sanitizeFeishuCopilotText("before&lt;analysis mode=&quot;deep&quot;&gt;private&lt;/analysis&gt;after"),
      "beforeafter"
    );
    assert.equal(sanitizeFeishuCopilotText("visible<analysis>unfinished private"), "visible");
    assert.equal(sanitizeFeishuCopilotText("visible</analysis>after"), "visibleafter");
    assert.equal(sanitizeFeishuCopilotText("<result>ordinary XML</result>"), "<result>ordinary XML</result>");

    const scrubber = createFeishuOutboundTextScrubber();
    assert.equal(scrubber.append("before<ANA"), "before");
    assert.equal(scrubber.append('LYSIS mode="deep">private'), "before");
    assert.equal(scrubber.append("</analysis>after"), "beforeafter");
  });

  it("removes nested named and numeric entities only when they reveal reasoning tags", () => {
    assert.equal(
      sanitizeFeishuCopilotText("&amp;lt;analysis&amp;gt;NAMED_REASON_SECRET&amp;lt;/analysis&amp;gt;visible"),
      "visible"
    );
    assert.equal(
      sanitizeFeishuCopilotText("&amp;#60;analysis&amp;#62;NUMERIC_REASON_SECRET&amp;#60;/analysis&amp;#62;visible"),
      "visible"
    );
    assert.equal(
      sanitizeFeishuCopilotText("&amp;#x3c;analysis&amp;#x3e;HEX_REASON_SECRET&amp;#x3c;/analysis&amp;#x3e;visible"),
      "visible"
    );
    assert.equal(
      sanitizeFeishuCopilotText("&lt;b&gt;benign encoded HTML&lt;/b&gt;"),
      "&lt;b&gt;benign encoded HTML&lt;/b&gt;"
    );
    assert.equal(
      sanitizeFeishuCopilotText("&amp;lt;b&amp;gt;nested benign HTML&amp;lt;/b&amp;gt;"),
      "&amp;lt;b&amp;gt;nested benign HTML&amp;lt;/b&amp;gt;"
    );
    const deepOpening = `&${"amp;".repeat(70)}lt;analysis&${"amp;".repeat(70)}gt;`;
    assert.equal(
      sanitizeFeishuCopilotText(`${deepOpening}OVER_CAP_REASON_SECRET`),
      ""
    );

    const scrubber = createFeishuOutboundTextScrubber();
    assert.equal(scrubber.append("before&amp;lt;ana"), "before");
    assert.equal(scrubber.append("lysis&amp;gt;SPLIT_REASON_SECRET"), "before");
    assert.equal(scrubber.append("&amp;lt;/analysis&amp;gt;after"), "beforeafter");
  });

  it("preserves benign encoded XML while selectively removing encoded reasoning", () => {
    assert.equal(
      sanitizeFeishuCopilotText(
        "&lt;b&gt;safe&lt;/b&gt; &lt;analysis&gt;secret&lt;/analysis&gt; visible"
      ),
      "&lt;b&gt;safe&lt;/b&gt;  visible"
    );
  });

  it("preserves non-sensitive entity bytes across reasoning encodings and stream boundaries", () => {
    const cases = [
      {
        input: "&lt;b&gt;before&lt;/b&gt;&lt;analysis mode=&quot;deep&quot;&gt;&lt;i&gt;inside&lt;/i&gt;secret&lt;/analysis&gt;&lt;result&gt;after&lt;/result&gt;",
        expected: "&lt;b&gt;before&lt;/b&gt;&lt;result&gt;after&lt;/result&gt;"
      },
      {
        input: "&amp;lt;a href=&quot;https://example.com&quot;&amp;gt;link&amp;lt;/a&amp;gt; &amp;lt;think&amp;gt;secret&amp;lt;/think&amp;gt; &amp;lt;result&amp;gt;ok&amp;lt;/result&amp;gt;",
        expected: "&amp;lt;a href=&quot;https://example.com&quot;&amp;gt;link&amp;lt;/a&amp;gt;  &amp;lt;result&amp;gt;ok&amp;lt;/result&amp;gt;"
      },
      {
        input: "&#60;b&#62;safe&#60;/b&#62; &#60;analysis&#62;secret&#60;/analysis&#62; &#x3c;result&#x3e;ok&#x3c;/result&#x3e;",
        expected: "&#60;b&#62;safe&#60;/b&#62;  &#x3c;result&#x3e;ok&#x3c;/result&#x3e;"
      }
    ];
    for (const { input, expected } of cases) {
      assert.equal(sanitizeFeishuCopilotText(input), expected);
    }

    const scrubber = createFeishuOutboundTextScrubber();
    assert.equal(
      scrubber.append("before &lt;b&gt;safe&lt;/b&gt; &amp;lt;ana"),
      "before &lt;b&gt;safe&lt;/b&gt; "
    );
    assert.equal(
      scrubber.append("lysis&amp;gt;secret &lt;i&gt;inside&lt;/i&gt;"),
      "before &lt;b&gt;safe&lt;/b&gt; "
    );
    assert.equal(
      scrubber.append("&amp;lt;/analysis&amp;gt; &lt;result&gt;after&lt;/result&gt;"),
      "before &lt;b&gt;safe&lt;/b&gt;  &lt;result&gt;after&lt;/result&gt;"
    );

    const deepOpening = `&${"amp;".repeat(70)}lt;analysis&${"amp;".repeat(70)}gt;`;
    assert.equal(
      sanitizeFeishuCopilotText(`&lt;a href=x&gt;link&lt;/a&gt; ${deepOpening}OVER_CAP_SECRET`),
      "&lt;a href=x&gt;link&lt;/a&gt; "
    );
    assert.equal(
      sanitizeFeishuCopilotText(
        `&lt;b&gt;safe&lt;/b&gt; &lt;analysis&gt;first secret&lt;/analysis&gt; visible ${deepOpening}SECOND_OVER_CAP_SECRET`
      ),
      "&lt;b&gt;safe&lt;/b&gt;  visible "
    );
  });

  it("fails closed for an over-cap decimal-amp encoded reasoning tag", () => {
    const prefix = `&#38;${"#38;".repeat(64)}`;
    const payload = `${prefix}lt;analysis${prefix}gt;INTERNAL_SECRET${prefix}lt;/analysis${prefix}gt;`;

    assert.equal(sanitizeFeishuCopilotText(payload), "");
  });

  it("uses source-map overflow boundaries for decimal, hex, and hybrid amp chains", () => {
    type AmpKind = "named" | "decimal" | "hex";
    const entityPart: Record<AmpKind, string> = {
      named: "amp;",
      decimal: "#38;",
      hex: "#x26;"
    };
    const ampChain = (depth: number, kinds: readonly AmpKind[]): string =>
      `&${Array.from({ length: depth }, (_, index) => entityPart[kinds[index % kinds.length]!]!).join("")}`;
    const encodedReasoning = (depth: number, kinds: readonly AmpKind[]): string => {
      const amp = ampChain(depth, kinds);
      return `${amp}lt;analysis${amp}gt;DEPTH_SECRET${amp}lt;/analysis${amp}gt;`;
    };
    const before = "&lt;b&gt;safe&lt;/b&gt; ";
    const after = " &lt;result&gt;visible&lt;/result&gt;";

    for (const kinds of [["decimal"], ["hex"], ["named", "decimal", "hex"]] as const) {
      for (const depth of [63, 64, 65, 70]) {
        const actual = sanitizeFeishuCopilotText(
          `${before}${encodedReasoning(depth, kinds)}${after}`
        );
        assert.doesNotMatch(actual, /DEPTH_SECRET/u, `${kinds.join("+")}:${depth}`);
        assert.equal(
          actual,
          depth === 63 ? `${before}${after}` : before,
          `${kinds.join("+")}:${depth}`
        );
      }
    }

    const decimal = ampChain(63, ["decimal"]);
    const hex = ampChain(63, ["hex"]);
    const named = ampChain(63, ["named"]);
    assert.equal(
      sanitizeFeishuCopilotText(
        `${before}${decimal}lt;analysis${hex}gt;MIXED_SECRET${named}lt;/analysis${decimal}gt;${after}`
      ),
      `${before}${after}`
    );

    const benign = `${ampChain(63, ["decimal", "hex", "named"])}lt;a href=x${ampChain(63, ["hex"])}gt;link${ampChain(63, ["named"])}lt;/a${ampChain(63, ["decimal"])}gt;`;
    assert.equal(sanitizeFeishuCopilotText(benign), benign);

    const scrubber = createFeishuOutboundTextScrubber();
    assert.equal(scrubber.append(`${before}${decimal}lt;ana`), before);
    assert.equal(scrubber.append(`lysis${hex}gt;STREAM_SECRET`), before);
    assert.equal(
      scrubber.append(`${named}lt;/analysis${decimal}gt;${after}`),
      `${before}${after}`
    );
  });

  it("preserves complete encoded HTML names that only prefix a reasoning tag", () => {
    const ordinary = [
      "&lt;a href=x&gt;link&lt;/a&gt;",
      "&amp;lt;a href=x&amp;gt;double link&amp;lt;/a&amp;gt;",
      "&lt;an&gt;x&lt;/an&gt;",
      "&lt;thinking-cap&gt;x&lt;/thinking-cap&gt;"
    ];

    for (const encoded of ordinary) {
      assert.equal(sanitizeFeishuCopilotText(encoded), encoded);
    }
  });

  it("keeps split reasoning private at every cumulative stream boundary", () => {
    const scrubber = createFeishuOutboundTextScrubber();

    assert.equal(scrubber.append("前言<REA"), "前言");
    assert.equal(scrubber.append("SONING_SCRATCHPAD mode=\"deep\">私密链"), "前言");
    assert.equal(scrubber.append("路</reasoning_scratchpad>公开"), "前言公开");
    assert.equal(scrubber.replace("<thought>另一段私密</thought>最终答案"), "最终答案");
  });

  it("redacts secrets before rendering any card body", () => {
    const card = buildCopilotRunCard({
      state: "done",
      text: [
        "公开 sk-secret123",
        "token=token-private-value",
        "app_secret='app-secret-value'",
        "password: password-value",
        "Authorization: Bearer private.token.value",
        "Authorization=\"Basic basic-auth-value\"",
        "-----BEGIN PRIVATE KEY-----",
        "private-key-material",
        "-----END PRIVATE KEY-----"
      ].join("\n")
    }) as Record<string, unknown>;

    assert.doesNotMatch(
      cardBody(card),
      /sk-secret123|token-private-value|app-secret-value|password-value|private\.token\.value|basic-auth-value|private-key-material|BEGIN PRIVATE KEY/u
    );
    assert.match(cardBody(card), /\[REDACTED\]/u);
  });

  it("recursively redacts a parseable JSON secret whose value contains an escaped quote", () => {
    const visible = prepareFeishuCopilotText('{"password":"prefix\\\"SECRET_TAIL"}');

    assert.deepEqual(JSON.parse(visible), { password: "[REDACTED]" });
    assert.doesNotMatch(visible, /prefix|SECRET_TAIL/u);
  });

  it("redacts a parseable JSON secret whose value contains escaped backslashes", () => {
    const visible = prepareFeishuCopilotText(
      '{"token":"prefix\\\\SECRET_TAIL","visible":"keep me"}'
    );

    assert.deepEqual(JSON.parse(visible), { token: "[REDACTED]", visible: "keep me" });
    assert.doesNotMatch(visible, /prefix|SECRET_TAIL/u);
  });

  it("redacts escaped-quote tails for token and Authorization JSON keys", () => {
    const visible = prepareFeishuCopilotText(JSON.stringify({
      token: 'prefix"TOKEN_TAIL',
      Authorization: 'Bearer prefix"AUTH_TAIL',
      visible: "keep me"
    }));

    assert.deepEqual(JSON.parse(visible), {
      token: "[REDACTED]",
      Authorization: "[REDACTED]",
      visible: "keep me"
    });
    assert.doesNotMatch(visible, /TOKEN_TAIL|AUTH_TAIL/u);
  });

  it("redacts complete Authorization credentials for Basic and Digest schemes", () => {
    const visible = prepareFeishuCopilotText([
      "Authorization: Basic basic-auth-secret",
      "authorization=Digest username=admin,response=SUPERSECRET"
    ].join("\n"));

    assert.equal(visible, [
      "Authorization: [REDACTED]",
      "authorization=[REDACTED]"
    ].join("\n"));
    assert.doesNotMatch(visible, /basic-auth-secret|admin|SUPERSECRET/u);
  });

  it("redacts Proxy-Authorization through CRLF without consuming normal lines", () => {
    const visible = prepareFeishuCopilotText([
      'Proxy-Authorization = "Custom scheme credential with spaces"',
      "Normal line stays",
      "AUTHORIZATION: Digest username=admin,response=LINE_SECRET",
      "Tail stays"
    ].join("\r\n"));

    assert.equal(visible, [
      "Proxy-Authorization = [REDACTED]",
      "Normal line stays",
      "AUTHORIZATION: [REDACTED]",
      "Tail stays"
    ].join("\r\n"));
    assert.doesNotMatch(visible, /credential with spaces|admin|LINE_SECRET/u);
  });

  it("redacts inline Authorization labels and quoted values to the line boundary", () => {
    const visible = prepareFeishuCopilotText([
      "Header Authorization: Basic inline-secret",
      'Metadata Proxy-Authorization="Custom quoted secret"',
      "next"
    ].join("\n"));

    assert.equal(visible, [
      "Header Authorization: [REDACTED]",
      "Metadata Proxy-Authorization=[REDACTED]",
      "next"
    ].join("\n"));
    assert.doesNotMatch(visible, /inline-secret|quoted secret/u);
  });

  it("does not treat Authorization substrings as credential labels", () => {
    const ordinary = "XAuthorization: ordinary\nAuthorizationStatus=ready\nProxy-AuthorizationStatus: okay";

    assert.equal(prepareFeishuCopilotText(ordinary), ordinary);
  });

  it("recursively redacts Authorization header keys in JSON", () => {
    const visible = prepareFeishuCopilotText(JSON.stringify({
      Authorization: "Basic json-secret",
      "proxy-authorization": "Digest username=admin,response=proxy-secret",
      message: "keep me"
    }));

    assert.deepEqual(JSON.parse(visible), {
      Authorization: "[REDACTED]",
      "proxy-authorization": "[REDACTED]",
      message: "keep me"
    });
    assert.doesNotMatch(visible, /json-secret|proxy-secret|admin/u);
  });

  it("redacts a direct JSON password key encoded with a numeric HTML entity", () => {
    const visible = prepareFeishuCopilotText('{"pass&#119;ord":"HTML_JSON_SECRET"}');

    assert.deepEqual(JSON.parse(visible), { "pass&#119;ord": "[REDACTED]" });
    assert.doesNotMatch(visible, /HTML_JSON_SECRET/u);
  });

  it("redacts direct JSON token and Authorization keys encoded with HTML entities", () => {
    const visible = prepareFeishuCopilotText(
      '{"to&#107;en":"TOKEN_HTML_SECRET","Authoriz&#97;tion":"Basic AUTH_HTML_SECRET"}'
    );

    assert.deepEqual(JSON.parse(visible), {
      "to&#107;en": "[REDACTED]",
      "Authoriz&#97;tion": "[REDACTED]"
    });
    assert.doesNotMatch(visible, /TOKEN_HTML_SECRET|AUTH_HTML_SECRET/u);
  });

  it("canonicalizes case, hex entities, and bounded nested amp encoding", () => {
    const visible = prepareFeishuCopilotText(
      '{"PaSs&#x57;oRd":"HEX_CASE_SECRET","pass&amp;#119;ord":"NESTED_ENTITY_SECRET"}'
    );

    assert.deepEqual(JSON.parse(visible), {
      "PaSs&#x57;oRd": "[REDACTED]",
      "pass&amp;#119;ord": "[REDACTED]"
    });
    assert.doesNotMatch(visible, /HEX_CASE_SECRET|NESTED_ENTITY_SECRET/u);
  });

  it("redacts entity-encoded sensitive keys inside nested quoted JSON", () => {
    const visible = prepareFeishuCopilotText(
      'Result: "{\\"nested\\":{\\"pass&#119;ord\\":\\"QUOTED_HTML_SECRET\\"},\\"visible\\":\\"keep me\\"}"'
    );

    assert.match(visible, /pass&#119;ord/u);
    assert.match(visible, /keep me/u);
    assert.match(visible, /\[REDACTED\]/u);
    assert.doesNotMatch(visible, /QUOTED_HTML_SECRET/u);
  });

  it("preserves entity false-positive and non-sensitive JSON byte-for-byte", () => {
    const ordinary = '{\n  "pass&#119;ordHint": "ordinary",\n  "to&#107;enizer": "keep",\n  "message&#33;": "visible"\n}';

    assert.equal(prepareFeishuCopilotText(ordinary), ordinary);
  });

  it("recursively redacts sensitive key variants inside nested objects and arrays", () => {
    const visible = prepareFeishuCopilotText(JSON.stringify({
      profile: {
        Pass_Word: "nested-password",
        "API Key": "nested-api-key",
        "private-key": "nested-private-key"
      },
      items: [
        { "Access-Token": "nested-access-token" },
        { APP_SECRET: "nested-app-secret", label: "keep me" }
      ]
    }));

    assert.deepEqual(JSON.parse(visible), {
      profile: {
        Pass_Word: "[REDACTED]",
        "API Key": "[REDACTED]",
        "private-key": "[REDACTED]"
      },
      items: [
        { "Access-Token": "[REDACTED]" },
        { APP_SECRET: "[REDACTED]", label: "keep me" }
      ]
    });
    assert.doesNotMatch(visible, /nested-(?:password|api-key|private-key|access-token|app-secret)/u);
  });

  it("recursively redacts a JSON document stored inside a non-sensitive JSON string", () => {
    const inner = JSON.stringify({
      password: 'prefix"SECRET_TAIL',
      nested: [{ refresh_token: "nested-token" }],
      visible: "keep me"
    });
    const visible = prepareFeishuCopilotText(JSON.stringify({ payload: inner }));
    const outer = JSON.parse(visible) as { payload: string };

    assert.deepEqual(JSON.parse(outer.payload), {
      password: "[REDACTED]",
      nested: [{ refresh_token: "[REDACTED]" }],
      visible: "keep me"
    });
    assert.doesNotMatch(visible, /SECRET_TAIL|nested-token/u);
  });

  it("redacts the complete escaped value of an embedded JSON assignment after a text prefix", () => {
    const visible = prepareFeishuCopilotText(
      'Result: {"password":"prefix\\\"SECRET_TAIL"}'
    );

    assert.equal(visible, "[REDACTED SENSITIVE LINE]");
    assert.doesNotMatch(visible, /prefix|SECRET_TAIL/u);
  });

  it("redacts sensitive values inside a quoted JSON string literal after prose", () => {
    const visible = prepareFeishuCopilotText(
      'Result: "{\\"password\\":\\"PREFIX_SECRET_TAIL\\"}"'
    );

    assert.equal(visible, 'Result: "{\\"password\\":\\"[REDACTED]\\"}"');
    assert.doesNotMatch(visible, /PREFIX_SECRET_TAIL/u);
  });

  it("fails closed when a quoted JSON sensitive key uses a Unicode escape", () => {
    const visible = prepareFeishuCopilotText(
      'Result: {\\"pass\\u0077ord\\":\\"UNICODE_SECRET\\"}'
    );

    assert.equal(visible, "[REDACTED SENSITIVE LINE]");
    assert.doesNotMatch(visible, /UNICODE_SECRET/u);
  });

  it("fails closed after an unmatched preceding quote without consuming CRLF", () => {
    const visible = prepareFeishuCopilotText(
      'Prelude "broken Result: "{\\"password\\":\\"PRECEDE_SECRET\\"}"\r\nNext line stays'
    );

    assert.equal(visible, "[REDACTED SENSITIVE LINE]\r\nNext line stays");
    assert.doesNotMatch(visible, /PRECEDE_SECRET/u);
  });

  it("normalizes Unicode, hex, case, and numeric HTML entities for invariant detection", () => {
    const visible = prepareFeishuCopilotText([
      'Case: {\\"PaSs\\u0057oRd\\":\\"CASE_SECRET\\"}',
      'Hex: {\\"to\\x6ben\\":\\"HEX_SECRET\\"}',
      "Html: {&#34;pass&#119;ord&#34;:&#34;HTML_SECRET&#34;}"
    ].join("\n"));

    assert.equal(visible, [
      "[REDACTED SENSITIVE LINE]",
      "[REDACTED SENSITIVE LINE]",
      "[REDACTED SENSITIVE LINE]"
    ].join("\n"));
    assert.doesNotMatch(visible, /CASE_SECRET|HEX_SECRET|HTML_SECRET/u);
  });

  it("fails closed when an invariant key inserts an encoded underscore", () => {
    const visible = prepareFeishuCopilotText("pass\\u005fword=[REDACTED] UNDERSCORE_SECRET");

    assert.equal(visible, "[REDACTED SENSITIVE LINE]");
    assert.doesNotMatch(visible, /UNDERSCORE_SECRET/u);
  });

  it("canonicalizes zero-width, combining, punctuation, and separator key variants", () => {
    const visible = prepareFeishuCopilotText([
      "pass\\u200Bword=[REDACTED] ZERO_WIDTH_SECRET",
      "Header Authori\\u200Bzation: [REDACTED] INLINE_AUTH_SECRET",
      "pass\u0301word=[REDACTED] COMBINING_SECRET",
      "pass—word=[REDACTED] PUNCTUATION_SECRET",
      "api\u202fkey=[REDACTED] SEPARATOR_SECRET"
    ].join("\n"));

    assert.equal(visible, Array.from({ length: 5 }, () =>
      "[REDACTED SENSITIVE LINE]"
    ).join("\n"));
    assert.doesNotMatch(
      visible,
      /ZERO_WIDTH_SECRET|INLINE_AUTH_SECRET|COMBINING_SECRET|PUNCTUATION_SECRET|SEPARATOR_SECRET/u
    );
  });

  it("fails closed when bounded entity decoding remains unresolved", () => {
    const nestedAmpKey = (depth: number): string => `pass&${"amp;".repeat(depth)}#119;ord`;
    for (const depth of [4, 5, 50]) {
      const secret = `NESTED_AMP_${depth}_SECRET`;
      const raw = JSON.stringify({ [nestedAmpKey(depth)]: secret, visible: "keep me" });
      const visible = prepareFeishuCopilotText(raw);
      const parsed = JSON.parse(visible) as Record<string, string>;

      assert.equal(parsed[nestedAmpKey(depth)], "[REDACTED]");
      assert.equal(parsed.visible, "keep me");
      assert.doesNotMatch(visible, new RegExp(secret, "u"));
    }
  });

  it("redacts nested Unicode key variants and bounds overlong key candidates", () => {
    const overlongKey = `pass${"\u200B".repeat(300)}word`;
    const raw = JSON.stringify({
      nested: [{ "pass\u200Bword": "NESTED_UNICODE_SECRET" }],
      [overlongKey]: "OVERLONG_KEY_SECRET",
      visible: "keep me"
    });
    const visible = prepareFeishuCopilotText(raw);
    const parsed = JSON.parse(visible) as Record<string, unknown>;

    assert.deepEqual(parsed.nested, [{ "pass\u200Bword": "[REDACTED]" }]);
    assert.equal(parsed[overlongKey], "[REDACTED]");
    assert.equal(parsed.visible, "keep me");
    assert.doesNotMatch(visible, /NESTED_UNICODE_SECRET|OVERLONG_KEY_SECRET/u);

    const plain = prepareFeishuCopilotText(
      `${overlongKey}=[REDACTED] OVERLONG_PLAIN_SECRET`
    );
    assert.equal(plain, "[REDACTED SENSITIVE LINE]");
  });

  it("does not redact canonical-key substring false positives", () => {
    const ordinary = [
      "XAuthorization=[REDACTED] ordinary",
      "passwordHint=[REDACTED] ordinary",
      "tokenizer=[REDACTED] ordinary",
      `${"long ordinary prefix ".repeat(20)}tokenizer=[REDACTED] ordinary`
    ].join("\n");

    assert.equal(prepareFeishuCopilotText(ordinary), ordinary);
  });

  it("detects sensitive keys after punctuation-prefixed inline labels", () => {
    const visible = prepareFeishuCopilotText([
      "Result(password=[REDACTED] PAREN_SECRET",
      "Result/Authori\\u200Bzation: [REDACTED] SLASH_SECRET",
      "Result.password=[REDACTED] DOT_SECRET",
      "Result-password=[REDACTED] DASH_SECRET",
      "Result/api_key=[REDACTED] API_KEY_SECRET",
      "Result/proxy-authorization&#58;[REDACTED] PROXY_AUTH_SECRET"
    ].join("\n"));

    assert.equal(visible, Array.from({ length: 6 }, () =>
      "[REDACTED SENSITIVE LINE]"
    ).join("\n"));
    assert.doesNotMatch(
      visible,
      /PAREN_SECRET|SLASH_SECRET|DOT_SECRET|DASH_SECRET|API_KEY_SECRET|PROXY_AUTH_SECRET/u
    );
  });

  it("treats every Symbol and Control character as a sensitive-key token boundary", () => {
    const visible = prepareFeishuCopilotText([
      "Result→password=[REDACTED] ARROW_SECRET",
      "Result💥password=[REDACTED] EMOJI_SECRET",
      "Result©password=[REDACTED] COPYRIGHT_SECRET",
      "Result$password=[REDACTED] DOLLAR_SECRET",
      "Result+password=[REDACTED] PLUS_SECRET",
      "Result\\u0001password=[REDACTED] CONTROL_SECRET",
      "Result\uE000password=[REDACTED] PRIVATE_USE_SECRET",
      "Result\uFDD0password=[REDACTED] UNASSIGNED_SECRET"
    ].join("\n"));

    assert.equal(visible, Array.from({ length: 8 }, () =>
      "[REDACTED SENSITIVE LINE]"
    ).join("\n"));
    assert.doesNotMatch(
      visible,
      /ARROW_SECRET|EMOJI_SECRET|COPYRIGHT_SECRET|DOLLAR_SECRET|PLUS_SECRET|CONTROL_SECRET|PRIVATE_USE_SECRET|UNASSIGNED_SECRET/u
    );
  });

  it("preserves non-ASCII ordinary keys while retaining substring false-positive guards", () => {
    const ordinary = [
      "用户名称=[REDACTED] ordinary",
      "密码提示=[REDACTED] ordinary",
      "XAuthorization=[REDACTED] ordinary",
      "passwordHint=[REDACTED] ordinary",
      "tokenizer=[REDACTED] ordinary"
    ].join("\n");

    assert.equal(prepareFeishuCopilotText(ordinary), ordinary);
  });

  it("normalizes fullwidth and encoded fullwidth assignment delimiters", () => {
    const visible = prepareFeishuCopilotText([
      "password：[REDACTED] FULLWIDTH_COLON_SECRET",
      "password＝[REDACTED] FULLWIDTH_EQUAL_SECRET",
      "password&#65306;[REDACTED] HTML_DECIMAL_COLON_SECRET",
      "password&#xFF1D;[REDACTED] HTML_HEX_EQUAL_SECRET",
      "password&amp;amp;amp;amp;amp;#65306;[REDACTED] HTML_DEEP_COLON_SECRET"
    ].join("\n"));

    assert.equal(visible, Array.from({ length: 5 }, () =>
      "[REDACTED SENSITIVE LINE]"
    ).join("\n"));
    assert.doesNotMatch(
      visible,
      /FULLWIDTH_COLON_SECRET|FULLWIDTH_EQUAL_SECRET|HTML_DECIMAL_COLON_SECRET|HTML_HEX_EQUAL_SECRET|HTML_DEEP_COLON_SECRET/u
    );
  });

  it("uses the central entity decoder for named and nested assignment delimiters", () => {
    const nestedNamed = (depth: number, entity: string): string =>
      `&${"amp;".repeat(depth)}${entity};`;
    const visible = prepareFeishuCopilotText([
      "password&colon;[REDACTED] NAMED_COLON_SECRET",
      "Authorization&equals;Basic NAMED_EQUALS_SECRET",
      "password&amp;colon;[REDACTED] NESTED_COLON_SECRET",
      `password${nestedNamed(5, "equals")}[REDACTED] DEEP5_EQUALS_SECRET`,
      `password${nestedNamed(70, "colon")}[REDACTED] DEEP70_COLON_SECRET`,
      "password&equals;&apos;QUOTED_SECRET&apos;",
      "pass&lowbar;word=[REDACTED] UNKNOWN_ENTITY_SECRET"
    ].join("\n"));

    assert.equal(visible, Array.from({ length: 7 }, () =>
      "[REDACTED SENSITIVE LINE]"
    ).join("\n"));
    assert.doesNotMatch(
      visible,
      /NAMED_COLON_SECRET|NAMED_EQUALS_SECRET|NESTED_COLON_SECRET|DEEP5_EQUALS_SECRET|DEEP70_COLON_SECRET|QUOTED_SECRET|UNKNOWN_ENTITY_SECRET/u
    );

    const structured = prepareFeishuCopilotText(JSON.stringify({
      "pass&lowbar;word": "STRUCTURED_UNKNOWN_ENTITY_SECRET",
      visible: "keep me"
    }));
    assert.deepEqual(JSON.parse(structured), {
      "pass&lowbar;word": "[REDACTED]",
      visible: "keep me"
    });
    const quoted = prepareFeishuCopilotText(
      'Result: "{\\"pass&lowbar;word\\":\\"QUOTED_UNKNOWN_ENTITY_SECRET\\"}"'
    );
    assert.doesNotMatch(quoted, /QUOTED_UNKNOWN_ENTITY_SECRET/u);
    assert.match(quoted, /\[REDACTED\]/u);
    const benignUnknown = "message&copy;field=[REDACTED] ordinary";
    assert.equal(prepareFeishuCopilotText(benignUnknown), benignUnknown);
  });

  it("normalizes single named math-letter entities without changing benign unknowns", () => {
    const visible = prepareFeishuCopilotText([
      "pass&wscr;ord=WSCR_SECRET",
      "auth&Oscr;rization=OSCR_SECRET",
      "to&kscr;en=KSCR_SECRET"
    ].join("\n"));

    assert.equal(visible, Array.from({ length: 3 }, () =>
      "[REDACTED SENSITIVE LINE]"
    ).join("\n"));
    assert.doesNotMatch(visible, /WSCR_SECRET|OSCR_SECRET|KSCR_SECRET/u);

    const benign = "message&copy;field=[REDACTED] ordinary";
    assert.equal(prepareFeishuCopilotText(benign), benign);
  });

  it("maps every verified math-letter named entity to its exact base letter", () => {
    const samples = [
      "p&ascr;ssword=MATH_ONE_SECRET",
      "p&ascr;&sscr;sword=MATH_TWO_SECRET",
      "&pscr;&ascr;&sscr;sword=MATH_THREE_SECRET",
      "p&ascr;&sscr;&sscr;word=MATH_THREE_ALT_SECRET",
      "&tscr;&oscr;&kscr;en=MATH_TOKEN_SECRET",
      "&pscr;&ascr;&sscr;&sscr;&wscr;&oscr;&rscr;&dscr;=MATH_ALL_SECRET",
      "p&Ascr;ssword=MATH_CASE_SECRET",
      "p&afr;ssword=MATH_FRAKTUR_SECRET",
      "t&oopf;ken=MATH_DOUBLE_STRUCK_SECRET",
      "p&#x1D4B6;ssword=MATH_NUMERIC_SECRET"
    ];
    const visible = prepareFeishuCopilotText(samples.join("\n"));

    assert.equal(visible, Array.from({ length: samples.length }, () =>
      "[REDACTED SENSITIVE LINE]"
    ).join("\n"));
    assert.doesNotMatch(visible, /MATH_[A-Z_]+_SECRET/u);
    const benign = "message&copy;field=[REDACTED] ordinary";
    assert.equal(prepareFeishuCopilotText(benign), benign);
  });

  it("fails closed at every central named-entity decode-cap boundary", () => {
    const nestedNamed = (depth: number, entity: string): string =>
      `&${"amp;".repeat(depth)}${entity};`;
    const samples = [
      ...[63, 64, 65].flatMap((depth) => [
        `password${nestedNamed(depth, "colon")}[REDACTED] COLON_${depth}_SECRET`,
        `password${nestedNamed(depth, "equals")}[REDACTED] EQUALS_${depth}_SECRET`
      ]),
      `pass${nestedNamed(64, "lt")}word=[REDACTED] LT_64_SECRET`,
      `pass${nestedNamed(64, "gt")}word=[REDACTED] GT_64_SECRET`,
      `pass${nestedNamed(64, "apos")}word=[REDACTED] APOS_64_SECRET`
    ];
    const visible = prepareFeishuCopilotText(samples.join("\n"));

    assert.equal(visible, Array.from({ length: samples.length }, () =>
      "[REDACTED SENSITIVE LINE]"
    ).join("\n"));
    assert.doesNotMatch(visible, /(?:COLON|EQUALS|LT|GT|APOS)_\d+_SECRET/u);
  });

  it("accumulates every bounded token suffix for fragmented sensitive aliases", () => {
    const deepDelimiter = `&${"amp;".repeat(70)}#61;`;
    const visible = prepareFeishuCopilotText([
      "Result/p-a-s-s-w-o-r-d=[REDACTED] SPLIT_PASSWORD_SECRET",
      "Result/a-u-t-h-o-r-i-z-a-t-i-o-n:[REDACTED] SPLIT_AUTH_SECRET",
      `Result/p-a-s-s-w-o-r-d${deepDelimiter}[REDACTED] SPLIT_DEEP_SECRET`
    ].join("\n"));

    assert.equal(visible, Array.from({ length: 3 }, () =>
      "[REDACTED SENSITIVE LINE]"
    ).join("\n"));
    assert.doesNotMatch(visible, /SPLIT_PASSWORD_SECRET|SPLIT_AUTH_SECRET|SPLIT_DEEP_SECRET/u);
  });

  it("redacts bounded mixed-script confusables without claiming full UTS39 coverage", () => {
    const visible = prepareFeishuCopilotText([
      "pаssword=[REDACTED] CYRILLIC_A_SECRET",
      "tοken=[REDACTED] GREEK_OMICRON_SECRET",
      "раssword=[REDACTED] COMMON_SKELETON_SECRET",
      "passwørd=[REDACTED] WILDCARD_SECRET",
      "𝐩𝐚𝐬𝐬𝐰𝐨𝐫𝐝=[REDACTED] MATH_SECRET",
      "ｐａｓｓｗｏｒｄ=[REDACTED] FULLWIDTH_KEY_SECRET"
    ].join("\n"));

    assert.equal(visible, Array.from({ length: 6 }, () =>
      "[REDACTED SENSITIVE LINE]"
    ).join("\n"));
    assert.doesNotMatch(
      visible,
      /CYRILLIC_A_SECRET|GREEK_OMICRON_SECRET|COMMON_SKELETON_SECRET|WILDCARD_SECRET|MATH_SECRET|FULLWIDTH_KEY_SECRET/u
    );

    const ordinary = [
      "密码提示=[REDACTED] ordinary",
      "用户令牌=[REDACTED] ordinary",
      "pass中word=[REDACTED] ordinary",
      "XAuthorization=[REDACTED] ordinary",
      "passwordHint=[REDACTED] ordinary"
    ].join("\n");
    assert.equal(prepareFeishuCopilotText(ordinary), ordinary);
  });

  it("decodes encoded assignment delimiters to a bounded fixed point", () => {
    const nestedDelimiter = (depth: number): string =>
      `password&${"amp;".repeat(depth)}#61;`;
    const visible = prepareFeishuCopilotText([
      "password&#61;NUMERIC_DELIMITER_SECRET",
      "password&#x3d;HEX_ENTITY_DELIMITER_SECRET",
      "password\\u003dUNICODE_DELIMITER_SECRET",
      "password\\x3dHEX_ESCAPE_DELIMITER_SECRET",
      "password&#58;NUMERIC_COLON_SECRET",
      "password&#x3a;HEX_ENTITY_COLON_SECRET",
      "password\\u003aUNICODE_COLON_SECRET",
      "password\\x3aHEX_ESCAPE_COLON_SECRET",
      `${nestedDelimiter(5)}ENC_DELIM_SECRET`,
      `${nestedDelimiter(50)}DEEP_DELIM_SECRET`,
      `${nestedDelimiter(70)}OVER_CAP_DELIM_SECRET`,
      `${nestedDelimiter(5)}[REDACTED] MARKER_TAIL_SECRET`,
      "Next line stays"
    ].join("\r\n"));

    assert.equal(visible, [
      "[REDACTED SENSITIVE LINE]",
      "[REDACTED SENSITIVE LINE]",
      "[REDACTED SENSITIVE LINE]",
      "[REDACTED SENSITIVE LINE]",
      "[REDACTED SENSITIVE LINE]",
      "[REDACTED SENSITIVE LINE]",
      "[REDACTED SENSITIVE LINE]",
      "[REDACTED SENSITIVE LINE]",
      "[REDACTED SENSITIVE LINE]",
      "[REDACTED SENSITIVE LINE]",
      "[REDACTED SENSITIVE LINE]",
      "[REDACTED SENSITIVE LINE]",
      "Next line stays"
    ].join("\r\n"));
    assert.doesNotMatch(
      visible,
      /DELIMITER_SECRET|COLON_SECRET|ENC_DELIM_SECRET|DEEP_DELIM_SECRET|OVER_CAP_DELIM_SECRET|MARKER_TAIL_SECRET/u
    );

    const safeStructured = '{"password":"[REDACTED]","visible":"keep me"}';
    assert.equal(prepareFeishuCopilotText(safeStructured), safeStructured);
  });

  it("rejects encoded sensitive assignments with trailing or unclosed redaction markers", () => {
    const visible = prepareFeishuCopilotText([
      "pass\\u0077ord=[REDACTED] SECRET_TAIL",
      'token=\\"[REDACTED]\\" TOKEN_TAIL',
      "api\\u005fkey: [REDACTED] API_TAIL",
      'pass\\u0077ord="[REDACTED]'
    ].join("\n"));

    assert.equal(visible, [
      "[REDACTED SENSITIVE LINE]",
      "[REDACTED SENSITIVE LINE]",
      "[REDACTED SENSITIVE LINE]",
      "[REDACTED SENSITIVE LINE]"
    ].join("\n"));
    assert.doesNotMatch(visible, /SECRET_TAIL|TOKEN_TAIL|API_TAIL/u);
  });

  it("fails closed when an unquoted redaction marker has a plain-text tail", () => {
    const visible = prepareFeishuCopilotText("password=[REDACTED] SECRET_TAIL");

    assert.equal(visible, "[REDACTED SENSITIVE LINE]");
    assert.doesNotMatch(visible, /SECRET_TAIL/u);
  });

  it("fails closed for every ASCII, long, and Unicode punctuation tail", () => {
    const visible = prepareFeishuCopilotText([
      "pass\\u0077ord=[REDACTED];;;;",
      "pass\\u0077ord=[REDACTED]))))",
      "pass\\u0077ord=[REDACTED]{[((",
      `pass\\u0077ord=[REDACTED]${";".repeat(10_000)}`,
      "pass\\u0077ord=[REDACTED]；）】",
      "Next line stays"
    ].join("\r\n"));

    assert.equal(visible, [
      "[REDACTED SENSITIVE LINE]",
      "[REDACTED SENSITIVE LINE]",
      "[REDACTED SENSITIVE LINE]",
      "[REDACTED SENSITIVE LINE]",
      "[REDACTED SENSITIVE LINE]",
      "Next line stays"
    ].join("\r\n"));
  });

  it("stays synchronized across odd, even, and multiple preceding quotes", () => {
    const samples = [
      'Prelude """broken Result: {\\"password\\":\\"MULTI_QUOTE_SECRET\\"}',
      `Prelude ${"\\".repeat(3)}"broken Result: {\\"token\\":\\"ODD_SLASH_SECRET\\"}`,
      `Prelude ${"\\".repeat(4)}"broken Result: {\\"app_secret\\":\\"EVEN_SLASH_SECRET\\"}`
    ];

    for (const sample of samples) {
      const visible = prepareFeishuCopilotText(sample);
      assert.match(visible, /\[REDACTED(?: JSON| SENSITIVE LINE)\]/u);
      assert.doesNotMatch(visible, /MULTI_QUOTE_SECRET|ODD_SLASH_SECRET|EVEN_SLASH_SECRET/u);
    }
  });

  it("preserves parsed redacted JSON but closes malformed encoded structures", () => {
    const safe = 'Result: "{\\"password\\":\\"[REDACTED]\\"}"';
    const malformed = 'Result: {\\"pass\\u0077ord\\":\\"[REDACTED]\\"}';

    assert.equal(prepareFeishuCopilotText(safe), safe);
    assert.equal(prepareFeishuCopilotText(malformed), "[REDACTED SENSITIVE LINE]");
  });

  it("preserves non-sensitive fields in a successfully parsed quoted JSON object", () => {
    const visible = prepareFeishuCopilotText(
      'Result: "{\\"password\\":\\"STRUCTURED_SECRET\\",\\"visible\\":\\"keep me\\",\\"count\\":2}"'
    );

    assert.equal(
      visible,
      'Result: "{\\"password\\":\\"[REDACTED]\\",\\"visible\\":\\"keep me\\",\\"count\\":2}"'
    );
    assert.doesNotMatch(visible, /STRUCTURED_SECRET/u);
  });

  it("fails closed for a malformed quoted JSON string without consuming the next line", () => {
    const visible = prepareFeishuCopilotText(
      'Result: "{\\"password\\":\\"MALFORMED_SECRET\nNext line stays'
    );

    assert.equal(visible, "Result: [REDACTED JSON]\nNext line stays");
    assert.doesNotMatch(visible, /MALFORMED_SECRET/u);
  });

  it("redacts token, Authorization, and private-key fields in quoted JSON literals", () => {
    const visible = prepareFeishuCopilotText([
      'Payload: "{\\"token\\":\\"TOKEN_LITERAL_SECRET\\"}"',
      'Payload: "{\\"Authorization\\":\\"Basic AUTH_LITERAL_SECRET\\"}"',
      'Payload: "{\\"private_key\\":\\"PRIVATE_KEY_LITERAL_SECRET\\"}"'
    ].join("\n"));

    assert.equal(visible, [
      'Payload: "{\\"token\\":\\"[REDACTED]\\"}"',
      'Payload: "{\\"Authorization\\":\\"[REDACTED]\\"}"',
      'Payload: "{\\"private_key\\":\\"[REDACTED]\\"}"'
    ].join("\n"));
    assert.doesNotMatch(
      visible,
      /TOKEN_LITERAL_SECRET|AUTH_LITERAL_SECRET|PRIVATE_KEY_LITERAL_SECRET/u
    );
  });

  it("preserves non-sensitive and false-positive quoted JSON literals byte-for-byte", () => {
    const ordinary = [
      'Result: "{\\"message\\":\\"keep me\\",\\"passwordHint\\":\\"ordinary\\"}"',
      'Say "password is a field name" here',
      'Malformed: "{\\"passwordHint\\":\\"still ordinary'
    ].join("\n");

    assert.equal(prepareFeishuCopilotText(ordinary), ordinary);
  });

  it("fails closed at the existing nested JSON depth limit", () => {
    let nested = JSON.stringify({ password: "TOO_DEEP_SECRET" });
    for (let depth = 0; depth < 9; depth += 1) nested = JSON.stringify({ payload: nested });

    const visible = prepareFeishuCopilotText(`Result: ${JSON.stringify(nested)}`);

    assert.match(visible, /REDACTED NESTED JSON/u);
    assert.doesNotMatch(visible, /TOO_DEEP_SECRET/u);
  });

  it("fails closed through the end of the line for a malformed quoted assignment", () => {
    const visible = prepareFeishuCopilotText(
      'Status password="prefix\\\"SECRET_TAIL and still secret\nNext line stays visible'
    );

    assert.doesNotMatch(visible, /prefix|SECRET_TAIL|still secret/u);
    assert.match(visible, /password="\[REDACTED\]"/u);
    assert.match(visible, /Next line stays visible/u);
  });

  it("preserves an ordinary JSON document byte-for-byte when it contains no sensitive content", () => {
    const ordinary = '{\n  "message": "ordinary content",\n  "items": [1, 2]\n}';

    assert.equal(prepareFeishuCopilotText(ordinary), ordinary);
  });

  it("streams one run card: running -> delta refresh -> done, without a duplicate text reply", async () => {
    const h = setup();
    await h.deliver("第一问");
    await h.deliver("第二问");

    // Two turns -> two run cards created (one per turn).
    assert.equal(h.sentCards.length, 2);
    assert.equal(h.sentCards.every((entry) => entry.messageId !== undefined), true);
    // The second turn emitted a delta; at least one in-place refresh happened.
    assert.ok(h.cardUpdates.some((update) =>
      JSON.stringify(update.card).includes("流式增量")
    ), "expected a streamed delta refresh");
    // Finalized cards carry the green done header with the full answer.
    assert.ok(h.cardUpdates.some((update) =>
      headerState(update.card) === "Copilot 已完成" && JSON.stringify(update.card).includes(`${defaultReply}#2`)
    ));
    // No plain-text duplicates of the final answer when the card path worked.
    assert.equal(h.sent.filter((message) => message.text.includes(defaultReply)).length, 0);
  });

  it("falls back to the legacy single text reply when card sending fails", async () => {
    const h = setup();
    h.setFailCardSend(true);
    await h.deliver("你好");

    assert.equal(h.sentCards.length, 0);
    assert.equal(h.cardUpdates.length, 0);
    assert.ok(h.sent.some((message) => message.text.includes(defaultReply)));
  });

  it("never exposes inline thinking and keeps the raw assistant message persisted", async () => {
    const raw = [
      "<thinking>内部推理</thinking>",
      "公开答案",
      "token=db-token-value app_secret=db-app-secret",
      'Result: {"password":"prefix\\\"DB_SECRET_TAIL"}',
      "api\\u005fkey=[REDACTED] DB_TAIL_SECRET",
      "pass\\u200Bword=[REDACTED] DB_ZERO_TAIL_SECRET",
      '{"pass&amp;amp;amp;amp;#119;ord":"DB_DEEP_ENTITY_SECRET"}',
      "Result.password=[REDACTED] DB_PUNCT_PREFIX_SECRET",
      "password&amp;amp;amp;amp;amp;#61;DB_ENCODED_DELIMITER_SECRET",
      "Result/p-a-s-s-w-o-r-d＝[REDACTED] DB_SPLIT_FULLWIDTH_SECRET",
      "pаssword=[REDACTED] DB_MIXED_SCRIPT_SECRET",
      "password&colon;[REDACTED] DB_NAMED_DELIMITER_SECRET",
      "pass&wscr;ord=DB_WSCR_SECRET",
      "&pscr;&ascr;&sscr;&sscr;&wscr;&oscr;&rscr;&dscr;=DB_MATH_ALL_SECRET",
      "&lt;b&gt;DB_SAFE&lt;/b&gt; &amp;lt;analysis&amp;gt;DB_ENTITY_REASON_SECRET&amp;lt;/analysis&amp;gt; &lt;result&gt;实体公开答案&lt;/result&gt;"
    ].join("\n");
    const h = setup({
      assistantText: raw,
      streamDeltas: ["<rea", "soning>流式内部推理</reasoning>公开"]
    });
    await h.deliver("你好");

    const allOutbound = [
      ...h.sent.map((entry) => entry.text),
      ...h.sentCards.map((entry) => JSON.stringify(entry.card)),
      ...h.cardUpdates.map((entry) => JSON.stringify(entry.card))
    ].join("\n");
    assert.doesNotMatch(
      allOutbound,
      /<\/?(?:thinking|reasoning)|内部推理|流式内部推理|db-token-value|db-app-secret|DB_SECRET_TAIL|DB_TAIL_SECRET|DB_ZERO_TAIL_SECRET|DB_DEEP_ENTITY_SECRET|DB_PUNCT_PREFIX_SECRET|DB_ENCODED_DELIMITER_SECRET|DB_SPLIT_FULLWIDTH_SECRET|DB_MIXED_SCRIPT_SECRET|DB_NAMED_DELIMITER_SECRET|DB_WSCR_SECRET|DB_MATH_ALL_SECRET|DB_ENTITY_REASON_SECRET/iu
    );
    assert.match(allOutbound, /公开答案|实体公开答案/u);
    assert.match(allOutbound, /&lt;b&gt;DB_SAFE&lt;\/b&gt;.*&lt;result&gt;实体公开答案&lt;\/result&gt;/u);
    const persisted = h.db.prepare(
      "SELECT content FROM copilot_messages WHERE role = 'assistant' ORDER BY created_at DESC LIMIT 1"
    ).get() as { content: string };
    assert.equal(persisted.content, raw);
  });

  it("uses one sanitized text fallback when the final in-place patch fails", async () => {
    const h = setup({
      assistantText: [
        "<analysis>内部推理</analysis>",
        "Authorization: Basic fallback-basic-secret",
        'Result: "{\\"private_key\\":\\"FALLBACK_PRIVATE_SECRET\\"}"',
        "pass\\u0077ord=[REDACTED] FALLBACK_TAIL_SECRET",
        "Authori\\u200Bzation=[REDACTED] FALLBACK_ZERO_SECRET",
        "Result.password&amp;amp;amp;amp;amp;#61;FALLBACK_ENCODED_DELIMITER_SECRET",
        "Result→password=[REDACTED] FALLBACK_SYMBOL_SECRET",
        "pаssword＝[REDACTED] FALLBACK_MIXED_FULLWIDTH_SECRET",
        "password&colon;[REDACTED] FALLBACK_NAMED_DELIMITER_SECRET",
        "auth&Oscr;rization=FALLBACK_OSCR_SECRET",
        "p&ascr;&sscr;&sscr;word=FALLBACK_MATH3_SECRET",
        "&lt;a href=x&gt;回退链接&lt;/a&gt; &amp;lt;analysis&amp;gt;FALLBACK_ENTITY_REASON_SECRET&amp;lt;/analysis&amp;gt; &lt;result&gt;实体回退答案&lt;/result&gt;",
        '{"Authoriz&#97;tion":"Basic FALLBACK_HTML_SECRET"}',
        "公开答案"
      ].join("\n"),
      cardUpdateFails: true
    });
    await h.deliver("你好");

    assert.equal(h.sentCards.length, 1);
    assert.deepEqual(h.sent, [{
      chatId: "oc_chat",
      text: [
        "Authorization: [REDACTED]",
        'Result: "{\\"private_key\\":\\"[REDACTED]\\"}"',
        "[REDACTED SENSITIVE LINE]",
        "[REDACTED SENSITIVE LINE]",
        "[REDACTED SENSITIVE LINE]",
        "[REDACTED SENSITIVE LINE]",
        "[REDACTED SENSITIVE LINE]",
        "[REDACTED SENSITIVE LINE]",
        "[REDACTED SENSITIVE LINE]",
        "[REDACTED SENSITIVE LINE]",
        "&lt;a href=x&gt;回退链接&lt;/a&gt;  &lt;result&gt;实体回退答案&lt;/result&gt;",
        "[REDACTED SENSITIVE LINE]",
        "公开答案"
      ].join("\n")
    }]);
    assert.doesNotMatch(
      h.sent[0]?.text ?? "",
      /analysis|内部推理|Basic|fallback-basic-secret|FALLBACK_PRIVATE_SECRET|FALLBACK_TAIL_SECRET|FALLBACK_ZERO_SECRET|FALLBACK_ENCODED_DELIMITER_SECRET|FALLBACK_SYMBOL_SECRET|FALLBACK_MIXED_FULLWIDTH_SECRET|FALLBACK_NAMED_DELIMITER_SECRET|FALLBACK_OSCR_SECRET|FALLBACK_MATH3_SECRET|FALLBACK_ENTITY_REASON_SECRET|FALLBACK_HTML_SECRET/iu
    );
  });

  it("forces a sanitized text fallback for rich content when the final patch fails", async () => {
    const h = setup({
      assistantText: "<think>内部推理</think>\n**公开答案**",
      cardUpdateFails: true
    });
    await h.deliver("你好");

    assert.equal(h.sentCards.length, 1, "must not replace the failed stream with a second card");
    assert.deepEqual(h.sent, [{ chatId: "oc_chat", text: "**公开答案**" }]);
  });

  it("sends at most one sanitized and marked text fallback when a long final patch fails", async () => {
    const h = setup({
      assistantText: `<reasoning>private chain</reasoning>${"公开内容".repeat(1_500)} token=private-token`,
      cardUpdateFails: true
    });
    await h.deliver("你好");

    assert.equal(h.sent.length, 1);
    assert.ok((h.sent[0]?.text.length ?? 0) <= 3_800);
    assert.match(h.sent[0]?.text ?? "", /…（已截断）$/u);
    assert.doesNotMatch(h.sent[0]?.text ?? "", /private chain|private-token|reasoning/iu);
  });

  it("sanitizes the text fallback when initial card creation fails", async () => {
    const h = setup({
      assistantText: "<think>内部推理</think>\n公开答案",
      cardSendFails: true
    });
    await h.deliver("你好");

    assert.deepEqual(h.sent, [{ chatId: "oc_chat", text: "公开答案" }]);
  });

  it("sanitizes and redacts before truncating a text fallback", async () => {
    const h = setup({
      assistantText: `<think type="analysis">${"秘密".repeat(3_000)}</think>公开答案 sk-secret123`,
      cardSendFails: true
    });
    await h.deliver("你好");

    assert.equal(h.sent.length, 1);
    assert.match(h.sent[0]?.text ?? "", /公开答案/u);
    assert.doesNotMatch(h.sent[0]?.text ?? "", /秘密|sk-secret123|<think/iu);
  });

  it("updates the run card to awaiting approval before sending the approval card", async () => {
    const h = setup({ awaitingApproval: true });
    await h.deliver("执行操作");

    assert.equal(h.sentCards.length, 2);
    assert.ok(h.cardUpdates.some((update) =>
      headerState(update.card) === "Copilot 等待审批" && cardBody(update.card).includes("stub_operate_tool")
    ));
  });

  it("renders approval buttons as direct Schema V2 elements", async () => {
    const h = setup({ awaitingApproval: true });
    await h.deliver("执行操作");

    const approvalCard = h.sentCards.find(
      (entry) => headerState(entry.card) === "Copilot 请求审批"
    )?.card;
    assert.ok(approvalCard);
    const body = approvalCard.body as { elements?: Array<{
      tag?: string;
      value?: Record<string, unknown>;
    }> } | undefined;
    const elements = body?.elements ?? [];

    assert.equal(
      elements.some((element) => element.tag === "action"),
      false,
      "Feishu Schema V2 rejects the legacy action container"
    );
    assert.deepEqual(
      elements
        .filter((element) => element.tag === "button")
        .map((element) => element.value?.copilot_decision),
      ["approve", "reject"]
    );
  });

  it("falls back to approval text when the approval card has no provider message id", async () => {
    const h = setup({ awaitingApproval: true, approvalCardNoMessageId: true });
    await h.deliver("执行操作");

    assert.ok(h.sent.some((message) => message.text.includes("回复 /approve 批准")));
  });

  it("sends a rejection confirmation when resolving the approval card in place fails", async () => {
    const h = setup({ awaitingApproval: true, cardUpdateFails: true });
    await h.deliver("执行操作");
    const runId = h.nextRunIdRef();
    const pending = h.db.prepare(
      "SELECT id FROM copilot_pending_actions WHERE run_id = ? LIMIT 1"
    ).get(runId) as { id: string };

    await h.channel.handleCardAction({
      chatId: "oc_chat",
      senderIdentity: "ou_owner",
      value: {
        copilot_decision: "reject",
        action_id: pending.id,
        run_id: runId,
        tool: "stub_operate_tool"
      },
      messageId: "msg_approval"
    });

    assert.ok(h.sent.some((message) => message.text === "已拒绝该操作。"));
  });

  it("serializes turns within the same chat", async () => {
    const h = setup();
    h.armHold();

    const ingressA = h.mkIngress("慢消息");
    assert.equal(h.channel.admitMessage(ingressA), true);
    const runningA = h.channel.processMessage(ingressA);

    const ingressB = h.mkIngress("快消息");
    assert.equal(h.channel.admitMessage(ingressB), true);
    const runningB = h.channel.processMessage(ingressB);

    // Give B a chance to (wrongly) start while A is held.
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(h.turnCalls.length, 1, "second turn must wait for the first");

    h.releaseHold();
    await Promise.all([runningA, runningB]);
    assert.deepEqual(
      h.turnCalls.map((call) => call.userText),
      ["慢消息", "快消息"]
    );
  });

  it("ignores stream events from another user even when the conversation id matches", async () => {
    const h = setup();
    h.armHold();
    const ingress = h.mkIngress("等待流事件");
    assert.equal(h.channel.admitMessage(ingress), true);
    const processing = h.channel.processMessage(ingress);
    while (h.turnCalls.length === 0) await new Promise((resolve) => setImmediate(resolve));

    h.eventBus.emitEvent({
      type: "copilot_run_updated",
      userId: "another_user",
      runId: "foreign_run",
      conversationId: h.turnCalls[0]!.conversationId,
      status: "running",
      textDelta: "其他租户的私密流内容",
      occurredAt: new Date()
    });
    await new Promise((resolve) => setImmediate(resolve));
    h.releaseHold();
    await processing;

    assert.doesNotMatch(JSON.stringify(h.cardUpdates), /其他租户的私密流内容/u);
  });

  it("sends an approval card and routes the button decision back", async () => {
    const h = setup({ awaitingApproval: true });
    await h.deliver("需要审批的事");
    const value = approvalValue(h.sentCards, "approve");
    assert.equal(
      h.channel.admitCardAction({
        chatId: "oc_chat", senderIdentity: "ou_owner",
        providerEventId: "evt_card_1", value
      }),
      true
    );
    await h.channel.handleCardAction({
      chatId: "oc_chat", senderIdentity: "ou_owner", value
    });

    assert.equal(h.resumeCalls.length, 1);
    assert.equal(h.resumeCalls[0]?.approved, true);
    assert.equal(h.resumeCalls[0]?.actionId, value.action_id);
    // Duplicate callback events are suppressed by the ledger admission.
    assert.equal(
      h.channel.admitCardAction({
        chatId: "oc_chat", senderIdentity: "ou_owner",
        providerEventId: "evt_card_1", value
      }),
      false
    );
  });

  it("rejects tampered, forwarded, and stale approval card identifiers without resuming", async () => {
    for (const field of ["conversation_id", "run_id", "action_id"] as const) {
      const h = setup({ awaitingApproval: true });
      await h.deliver("需要审批的事");
      const value = { ...approvalValue(h.sentCards, "approve"), [field]: `tampered_${field}` };

      await h.channel.handleCardAction({ chatId: "oc_chat", senderIdentity: "ou_owner", value });

      assert.equal(h.resumeCalls.length, 0, `${field} must be server-validated`);
      assert.ok(h.sent.some((message) => message.text.includes("审批请求无效或已失效")));
    }

    const forwarded = setup({ awaitingApproval: true });
    await forwarded.deliver("A 操作", "oc_a");
    const valueA = approvalValue(forwarded.sentCards, "approve");
    await forwarded.deliver("B 操作", "oc_b");
    const valueB = approvalValue(
      forwarded.sentCards.filter((entry) => entry.chatId === "oc_b"),
      "approve"
    );
    await forwarded.channel.handleCardAction({
      chatId: "oc_a",
      senderIdentity: "ou_owner",
      value: valueB
    });
    assert.equal(forwarded.resumeCalls.length, 0, "another chat's valid pending action must be rejected");

    await forwarded.channel.handleCardAction({ chatId: "oc_a", senderIdentity: "ou_owner", value: valueA });
    assert.equal(forwarded.resumeCalls.length, 1);
    await forwarded.channel.handleCardAction({ chatId: "oc_a", senderIdentity: "ou_owner", value: valueA });
    assert.equal(forwarded.resumeCalls.length, 1, "a decided action must not resume twice");
  });

  it("derives the tool from the persisted pending action instead of the card value", async () => {
    const h = setup({ awaitingApproval: true });
    await h.deliver("需要审批的事");
    const value = { ...approvalValue(h.sentCards, "reject"), tool: "tampered_tool" };
    const approvalMessage = h.sentCards.find((entry) => headerState(entry.card) === "Copilot 请求审批");

    await h.channel.handleCardAction({
      chatId: "oc_chat",
      senderIdentity: "ou_owner",
      value,
      messageId: approvalMessage?.messageId
    });

    const resolved = h.cardUpdates.at(-1)?.card;
    assert.ok(resolved);
    assert.match(JSON.stringify(resolved), /stub_operate_tool/u);
    assert.doesNotMatch(JSON.stringify(resolved), /tampered_tool/u);
  });

  it("renders approved-running then completed with the persisted tool result", async () => {
    const h = setup({
      awaitingApproval: true,
      approvalOutcome: "completed",
      approvalToolResult: "真实输出<think>隐藏推理</think> sk-secret123"
    });
    await h.deliver("执行操作");
    const value = approvalValue(h.sentCards, "approve");
    const approvalMessage = h.sentCards.find((entry) => headerState(entry.card) === "Copilot 请求审批");

    await h.channel.handleCardAction({
      chatId: "oc_chat", senderIdentity: "ou_owner", value, messageId: approvalMessage?.messageId
    });

    const approvalUpdates = h.cardUpdates.filter((entry) => entry.messageId === approvalMessage?.messageId);
    assert.match(headerState(approvalUpdates[0]!.card) ?? "", /已批准，正在执行/u);
    assert.equal(headerState(approvalUpdates.at(-1)!.card), "执行完成：stub_operate_tool");
    assert.match(cardBody(approvalUpdates.at(-1)!.card), /真实输出/u);
    assert.doesNotMatch(JSON.stringify(approvalUpdates), /已批准并执行|隐藏推理|sk-secret123/u);
  });

  it("strongly redacts approval input and tool result on every card update", async () => {
    const h = setup({
      awaitingApproval: true,
      approvalInputJson: [
        "Result/Authori\\u200Bzation&amp;amp;amp;amp;amp;#58;[REDACTED] APPROVAL_DELIMITER_SECRET",
        "Result💥password=[REDACTED] APPROVAL_SYMBOL_SECRET",
        "pаssword＝[REDACTED] APPROVAL_MIXED_FULLWIDTH_SECRET",
        "password&colon;[REDACTED] APPROVAL_NAMED_DELIMITER_SECRET",
        "to&kscr;en=APPROVAL_KSCR_SECRET",
        "&pscr;&ascr;&sscr;sword=APPROVAL_MATH3_SECRET",
        "&lt;b&gt;审批安全&lt;/b&gt; &amp;lt;analysis&amp;gt;APPROVAL_ENTITY_REASON_SECRET&amp;lt;/analysis&amp;gt; &lt;result&gt;审批公开&lt;/result&gt;"
      ].join("\n"),
      approvalToolResult: [
        "password&amp;amp;amp;amp;amp;#61;TOOL_DELIMITER_SECRET",
        "Result©password=[REDACTED] TOOL_SYMBOL_SECRET",
        "a-u-t-h-o-r-i-z-a-t-i-o-n:[REDACTED] TOOL_SPLIT_SECRET",
        "pass&wscr;ord=TOOL_WSCR_SECRET",
        "&tscr;&oscr;&kscr;en=TOOL_MATH3_SECRET",
        "&lt;a href=x&gt;工具链接&lt;/a&gt; &amp;lt;analysis&amp;gt;TOOL_ENTITY_REASON_SECRET&amp;lt;/analysis&amp;gt; &lt;result&gt;真实工具实体输出&lt;/result&gt;"
      ].join("\n")
    });
    await h.deliver("需要审批的事");
    const approvalMessage = h.sentCards.find((entry) => headerState(entry.card) === "Copilot 请求审批");
    assert.ok(approvalMessage?.messageId);
    assert.doesNotMatch(
      JSON.stringify(approvalMessage.card),
      /APPROVAL_DELIMITER_SECRET|APPROVAL_SYMBOL_SECRET|APPROVAL_MIXED_FULLWIDTH_SECRET|APPROVAL_NAMED_DELIMITER_SECRET|APPROVAL_KSCR_SECRET|APPROVAL_MATH3_SECRET|APPROVAL_ENTITY_REASON_SECRET/u
    );
    assert.match(JSON.stringify(approvalMessage.card), /\[REDACTED(?: SENSITIVE LINE| JSON)?\]/u);
    assert.match(
      JSON.stringify(approvalMessage.card),
      /&lt;b&gt;审批安全&lt;\/b&gt;.*&lt;result&gt;审批公开&lt;\/result&gt;/u
    );

    const value = approvalValue(h.sentCards, "approve");
    await h.channel.handleCardAction({
      chatId: "oc_chat",
      senderIdentity: "ou_owner",
      value,
      messageId: approvalMessage.messageId
    });

    const finalCard = h.cardUpdates
      .filter((entry) => entry.messageId === approvalMessage.messageId)
      .at(-1)!.card;
    assert.doesNotMatch(
      JSON.stringify(finalCard),
      /TOOL_DELIMITER_SECRET|TOOL_SYMBOL_SECRET|TOOL_SPLIT_SECRET|TOOL_WSCR_SECRET|TOOL_MATH3_SECRET|TOOL_ENTITY_REASON_SECRET/u
    );
    assert.match(JSON.stringify(finalCard), /真实工具实体输出/u);
    assert.match(
      JSON.stringify(finalCard),
      /&lt;a href=x&gt;工具链接&lt;\/a&gt;.*&lt;result&gt;真实工具实体输出&lt;\/result&gt;/u
    );
    assert.match(JSON.stringify(finalCard), /\[REDACTED(?: SENSITIVE LINE| JSON)?\]/u);
  });

  it("renders a failed approval outcome without claiming execution completed", async () => {
    const h = setup({
      awaitingApproval: true,
      approvalOutcome: "failed",
      approvalRunError: "执行失败 sk-secret123"
    });
    await h.deliver("执行操作");
    const value = approvalValue(h.sentCards, "approve");
    const approvalMessage = h.sentCards.find((entry) => headerState(entry.card) === "Copilot 请求审批");

    await h.channel.handleCardAction({
      chatId: "oc_chat", senderIdentity: "ou_owner", value, messageId: approvalMessage?.messageId
    });

    const finalCard = h.cardUpdates.filter((entry) => entry.messageId === approvalMessage?.messageId).at(-1)!.card;
    assert.equal(headerState(finalCard), "执行失败：stub_operate_tool");
    assert.doesNotMatch(JSON.stringify(finalCard), /已批准并执行|sk-secret123/u);
  });

  it("renders still-running after the bounded approval settle timeout", async () => {
    const h = setup({
      awaitingApproval: true,
      approvalOutcome: "running",
      approvalSettleTimeoutMs: 1
    });
    await h.deliver("执行操作");
    const value = approvalValue(h.sentCards, "approve");
    const approvalMessage = h.sentCards.find((entry) => headerState(entry.card) === "Copilot 请求审批");

    await h.channel.handleCardAction({
      chatId: "oc_chat", senderIdentity: "ou_owner", value, messageId: approvalMessage?.messageId
    });

    const finalCard = h.cardUpdates.filter((entry) => entry.messageId === approvalMessage?.messageId).at(-1)!.card;
    assert.equal(headerState(finalCard), "仍在执行：stub_operate_tool");
    assert.doesNotMatch(JSON.stringify(finalCard), /已批准并执行|执行完成/u);
  });

  it("rejects card decisions from a non-owner sender", async () => {
    const h = setup();
    await h.deliver("建立会话");
    const runId = h.nextRunIdRef();
    const pending = h.recordAwaiting(runId);

    await h.channel.handleCardAction({
      chatId: "oc_chat",
      senderIdentity: "ou_stranger",
      value: { copilot_decision: "approve", action_id: pending.id, run_id: pending.runId },
      messageId: "msg_x"
    });

    assert.equal(h.resumeCalls.length, 0);
    assert.ok(h.sent.some((message) => message.text.includes("该会话已由其他飞书用户开启")));
  });
});
