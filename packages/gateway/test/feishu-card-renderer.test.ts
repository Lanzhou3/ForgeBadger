import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  renderFeishuApprovalCard,
  renderFeishuAutomationCard,
  renderFeishuCardActionAcceptedResponse,
  renderFeishuMarkdownCard,
  renderFeishuProjectManagerCard
} from "../src/services/integrations/feishu-card-renderer.js";

describe("trusted Feishu card renderers", () => {
  it("renders markdown and project-manager cards from bounded typed inputs", () => {
    const markdown = renderFeishuMarkdownCard({ title: "Weekly report", markdown: "**Done**" });
    const project = renderFeishuProjectManagerCard({
      projectName: "OpenForge",
      status: "On track",
      summary: "Gateway work completed",
      blockers: ["Live Feishu evidence pending"]
    });

    assert.equal(markdown.config.wide_screen_mode, true);
    assert.equal(markdown.header.template, "blue");
    assert.equal(markdown.elements[0]?.tag, "markdown");
    assert.equal("schema" in markdown, false);
    assert.equal("body" in markdown, false);
    assert.equal(project.header.title.content, "OpenForge · On track");
  });

  it("puts only version and opaque action id in card buttons", () => {
    const card = renderFeishuApprovalCard({
      title: "Approve automation",
      summary: "Send a weekly report",
      approveActionId: "action-approve",
      rejectActionId: "action-reject"
    });
    const serialized = JSON.stringify(card);

    assert.equal(card.header.template, "orange");
    assert.equal(card.elements[1]?.tag, "action");
    assert.match(serialized, /action-approve/);
    assert.match(serialized, /"version":1/);
    assert.doesNotMatch(serialized, /pendingActionId|userId|chatId|permission|payloadDigest/);
  });

  it("returns an inline processing card after a card action is durably admitted", () => {
    const response = renderFeishuCardActionAcceptedResponse();
    const serialized = JSON.stringify(response);

    assert.equal(response.card.type, "raw");
    assert.equal(response.card.data.header.template, "blue");
    assert.match(response.card.data.header.title.content, /已收到/);
    assert.match(serialized, /完成结果会另行回复/);
    assert.doesNotMatch(serialized, /action_id|button/);
  });

  it("rejects oversized text, unsafe URLs, excessive actions, and invalid ids", () => {
    assert.throws(
      () => renderFeishuMarkdownCard({ title: "x", markdown: "x".repeat(20_001) }),
      /FEISHU_CARD_CONTENT_TOO_LONG/
    );
    assert.throws(
      () => renderFeishuAutomationCard({
        name: "Weekly",
        schedule: "Monday 09:00",
        status: "active",
        actionIds: ["a", "b", "c", "d"]
      }),
      /FEISHU_CARD_TOO_MANY_ACTIONS/
    );
    assert.throws(
      () => renderFeishuMarkdownCard({
        title: "Unsafe",
        markdown: "link",
        openUrl: "javascript:alert(1)"
      }),
      /FEISHU_CARD_URL_UNSAFE/
    );
    assert.throws(
      () => renderFeishuApprovalCard({
        title: "Invalid",
        summary: "Invalid action",
        approveActionId: "{raw-json}",
        rejectActionId: "valid-id"
      }),
      /FEISHU_CARD_ACTION_ID_INVALID/
    );
  });
});
