import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  automationExecutionId,
  normalizeAutomationSchedule,
  nextAutomationRunAt
} from "../src/services/copilot/automation-types.js";
import { evaluateAutomationAction } from "../src/services/copilot/automation-policy.js";

describe("Copilot automation schedules", () => {
  it("normalizes at, every, and cron schedules into stable slots", () => {
    const now = new Date("2026-08-12T00:00:00.000Z");
    const at = normalizeAutomationSchedule({ kind: "at", at: "2026-08-13T09:00:00+08:00" }, now);
    const every = normalizeAutomationSchedule({ kind: "every", intervalMs: 3_600_000 }, now);
    const cron = normalizeAutomationSchedule({ kind: "cron", expression: "0 9 * * 1", timezone: "Asia/Shanghai" }, now);

    assert.equal(at.nextRunAt.toISOString(), "2026-08-13T01:00:00.000Z");
    assert.equal(every.nextRunAt.toISOString(), "2026-08-12T01:00:00.000Z");
    assert.equal(cron.nextRunAt.toISOString(), "2026-08-17T01:00:00.000Z");
    assert.equal(
      nextAutomationRunAt(cron, cron.nextRunAt)?.toISOString(),
      "2026-08-24T01:00:00.000Z"
    );
    assert.equal(automationExecutionId("automation-1", cron.nextRunAt), automationExecutionId("automation-1", cron.nextRunAt));
  });

  it("rejects ambiguous local times, invalid zones, and unsafe intervals", () => {
    assert.throws(
      () => normalizeAutomationSchedule({ kind: "at", at: "2026-11-01T01:30:00" }),
      /AUTOMATION_AT_TIMEZONE_REQUIRED/
    );
    assert.throws(
      () => normalizeAutomationSchedule({ kind: "cron", expression: "0 9 * * 1", timezone: "Mars\/Base" }),
      /AUTOMATION_TIMEZONE_INVALID/
    );
    assert.throws(
      () => normalizeAutomationSchedule({ kind: "every", intervalMs: 999 }),
      /AUTOMATION_INTERVAL_INVALID/
    );
  });
});

describe("Automation action policy", () => {
  const base = {
    scope: { type: "project" as const, projectIds: ["project-1"] },
    schedule: { kind: "cron" as const, expression: "0 9 * * 1", timezone: "Asia/Shanghai" },
    delivery: { channel: "feishu" as const, accountId: "account-1", chatId: "chat-1" },
    toolAuthority: ["project.read", "session.read"]
  };

  it("keeps observe mode and workspace automations behind approval", () => {
    assert.equal(evaluateAutomationAction({ mode: "observe", callerTools: base.toolAuthority, proposed: base }).requiresApproval, true);
    const workspace = { ...base, scope: { type: "workspace" as const } };
    assert.deepEqual(
      evaluateAutomationAction({ mode: "operate", callerTools: base.toolAuthority, proposed: workspace }).reasons,
      ["workspace_scope"]
    );
  });

  it("permits bounded project operation but flags recipient, frequency, and tool expansion", () => {
    assert.equal(evaluateAutomationAction({ mode: "operate", callerTools: base.toolAuthority, proposed: base }).requiresApproval, false);
    assert.ok(evaluateAutomationAction({
      mode: "operate",
      callerTools: [...base.toolAuthority, "project.write"],
      current: base,
      proposed: {
        ...base,
        schedule: { kind: "every", intervalMs: 60_000 },
        delivery: { ...base.delivery, chatId: "chat-2" },
        toolAuthority: [...base.toolAuthority, "project.write"]
      }
    }).reasons.includes("recipient_changed"));
  });

  it("rejects authority beyond the caller cap and stale revisions", () => {
    assert.throws(
      () => evaluateAutomationAction({
        mode: "operate",
        callerTools: ["project.read"],
        proposed: { ...base, toolAuthority: ["project.read", "shell.execute"] }
      }),
      /AUTOMATION_TOOL_AUTHORITY_EXCEEDED/
    );
    assert.throws(
      () => evaluateAutomationAction({
        mode: "operate",
        callerTools: base.toolAuthority,
        proposed: base,
        expectedRevision: 2,
        currentRevision: 3
      }),
      /AUTOMATION_REVISION_CONFLICT/
    );
  });
});
