import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  auditTrialFeedbackPacket,
  parseAuditCliArgs
} from "./audit-trial-feedback-packet.mjs";
import { buildTrialFeedbackDraft } from "./create-trial-feedback-draft.mjs";

describe("trial feedback packet audit", () => {
  it("rejects generated drafts as incomplete first-user evidence", () => {
    const result = auditTrialFeedbackPacket(buildTrialFeedbackDraft({
      commit: "abc1234",
      os: "linux x64 6.8.0",
      shell: "/bin/zsh",
      nodeVersion: "v24.14.1",
      tmuxVersion: "tmux 3.4",
      claudeVersion: "2.1.152"
    }));

    assert.equal(result.ok, false);
    assert.equal(result.readyForHumanTriage, false);
    assert.match(result.errors.join("\n"), /Generated draft status/);
    assert.match(result.errors.join("\n"), /Redaction review completed.*yes/);
  });

  it("accepts a completed redacted packet as ready for human triage only", () => {
    const result = auditTrialFeedbackPacket(buildCompletedPacket());

    assert.deepEqual(result, {
      ok: true,
      readyForHumanTriage: true,
      gateClearingEvidence: false,
      errors: [],
      warnings: [
        "Packet audit passing means ready for maintainer triage, not automatic FIRST-USER-FEEDBACK gate clearance."
      ]
    });
  });

  it("rejects unsafe secret-like content", () => {
    const packet = `${buildCompletedPacket()}\nAuthorization: Bearer secret-token\nprovider key sk-test-secret\n`;
    const result = auditTrialFeedbackPacket(packet);

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /secret-like content/);
  });

  it("rejects generic placeholder values and placeholder section bodies", () => {
    const result = auditTrialFeedbackPacket(buildPlaceholderPacket());

    assert.equal(result.ok, false);
    assert.equal(result.readyForHumanTriage, false);
    assert.match(result.errors.join("\n"), /Result contains placeholder content/);
    assert.match(result.errors.join("\n"), /Severity contains placeholder content/);
    assert.match(result.errors.join("\n"), /Reproduction Steps must include at least two completed numbered steps/);
    assert.match(result.errors.join("\n"), /Expected Behavior must be filled/);
    assert.match(result.errors.join("\n"), /Actual Behavior must be filled/);
  });

  it("rejects template slash-option placeholders in export path fields", () => {
    const packet = buildCompletedPacket().replace(
      "Export path used: Settings -> Export diagnostics JSON",
      "Export path used: Settings -> Export diagnostics JSON / unavailable"
    );
    const result = auditTrialFeedbackPacket(packet);

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /Export path used still contains placeholder options/);
  });

  it("parses packet path and json flag", () => {
    assert.deepEqual(parseAuditCliArgs(["--", "/tmp/packet.md", "--json"]), {
      packetPath: "/tmp/packet.md",
      json: true
    });

    assert.throws(() => parseAuditCliArgs([]), /Usage/);
    assert.throws(() => parseAuditCliArgs(["/tmp/a.md", "/tmp/b.md"]), /Unexpected argument/);
  });
});

function buildCompletedPacket() {
  return `# OpenForge Trial Feedback Packet

## Summary

- Result: pass with caveats
- Affected surface: terminal
- Startup path: source fallback
- OpenForge version or commit: abc1234
- Operating system: linux x64 6.8.0
- Shell: /bin/zsh
- Windows native or WSL, if applicable: not applicable
- Browser and version: Chromium 125

## Dependency Versions

- node --version: v24.14.1
- tmux -V: tmux 3.4
- claude --version: 2.1.152
- openforge doctor summary: terminal native_tmux

## Diagnostics Export

- Diagnostics export attached: yes
- Export path used: Settings -> Export diagnostics JSON
- Redaction review completed: yes

## Reproduction Steps

1. Start Gateway and Web from source fallback.
2. Create a disposable project and Claude Code session.
3. Attach terminal, type a harmless prompt, resize, refresh, and stop.

## Expected Behavior

Browser terminal remains attached after refresh and the stopped session stays stopped.

## Actual Behavior

The trial completed with a caveat: no physical Windows/WSL host was available.

## Triage

- Category: platform
- Severity: medium
- Mapped requirement: UX-01
- Owner: maintainer
- Disposition: preserved caveat
- Follow-up route: issue #4 WINDOWS-WSL
- Next action or no-action rationale: rerun on physical Windows/WSL host
- Caveat status: pass with caveats

## Browser Evidence

- Console errors: none observed
- Network failures: none observed
- pnpm smoke:copilot-provider result: skipped
- Provider smoke skip or failure reason: missing_provider_credential
- Copilot provider with active model configured: skipped
- Terminal attach result: passed
- Terminal input/output result summary, no raw transcript: passed with harmless prompt
- Terminal resize result: passed
- Refresh/reconnect result: passed
- Stop-session result: passed
- Gateway/Web restart recovery result: passed
- Screenshots or written observations, redacted: attached separately

## Bounded Support Notes

- Gateway log summary, no raw log attachment: no errors observed
- Web log summary, no raw log attachment: no errors observed
- Relevant command result summary, no raw private output: script harness passed
`;
}

function buildPlaceholderPacket() {
  return `# OpenForge Trial Feedback Packet

## Summary

- Result: TBD
- Affected surface: TODO
- Startup path: ...
- OpenForge version or commit: TBD
- Operating system: TBD
- Shell: TBD
- Browser and version: TBD

## Dependency Versions

- node --version: TBD
- tmux -V: TODO
- claude --version: ...
- openforge doctor summary: n/a

## Diagnostics Export

- Diagnostics export attached: TBD
- Export path used: TBD
- Redaction review completed: yes

## Reproduction Steps

1. TBD
2. TODO

## Expected Behavior

...

## Actual Behavior

n/a

## Triage

- Category: TODO
- Severity: TBD
- Mapped requirement: ...
- Owner: TBD
- Disposition: TODO
- Follow-up route: TBD
- Next action or no-action rationale: ...
- Caveat status: TBD

## Browser Evidence

- Terminal attach result: TBD
- Terminal input/output result summary, no raw transcript: TBD
- Terminal resize result: TBD
- Refresh/reconnect result: TBD
- Stop-session result: TBD
- Gateway/Web restart recovery result: TBD

## Bounded Support Notes

- Gateway log summary, no raw log attachment: TBD
- Web log summary, no raw log attachment: TODO
`;
}
