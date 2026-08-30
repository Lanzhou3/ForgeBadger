import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  auditTrialFeedbackIssue,
  DEFAULT_REPOSITORY,
  parseTrialFeedbackIssueAuditCliArgs
} from "./audit-trial-feedback-issue.mjs";

describe("trial feedback GitHub issue audit", () => {
  it("keeps the existing GitHub remote as the default repository", () => {
    assert.equal(DEFAULT_REPOSITORY, "Lanzhou3/OpenForge");
  });
  it("audits a completed GitHub issue form body as ready for human triage only", async () => {
    const result = await auditTrialFeedbackIssue({
      issueNumber: 42,
      fetchIssue: async () => buildIssue()
    });

    assert.equal(result.ok, true);
    assert.equal(result.readyForHumanTriage, true);
    assert.equal(result.gateClearingEvidence, false);
    assert.deepEqual(result.errors, []);
    assert.equal(result.issue.number, 42);
    assert.equal(result.issue.url, "https://example.test/issues/42");
    assert.match(result.warnings.join("\n"), /not automatic FIRST-USER-FEEDBACK gate clearance/);
  });

  it("rejects missing trial feedback labels and incomplete issue bodies", async () => {
    const result = await auditTrialFeedbackIssue({
      issueNumber: 42,
      fetchIssue: async () => buildIssue({
        labels: [{ name: "product-hardening" }],
        body: "### Trial result\n\npass\n"
      })
    });

    assert.equal(result.ok, false);
    assert.equal(result.readyForHumanTriage, false);
    assert.equal(result.gateClearingEvidence, false);
    assert.match(result.errors.join("\n"), /must keep label: trial-feedback/);
    assert.match(result.errors.join("\n"), /Missing required field value: Redaction review completed/);
  });

  it("rejects the known first-user feedback tracker even if its body looks complete", async () => {
    const result = await auditTrialFeedbackIssue({
      issueNumber: 5,
      fetchIssue: async () => buildIssue({
        number: 5,
        title: "Collect first-user Copilot hardening feedback",
        url: "https://example.test/issues/5"
      })
    });

    assert.equal(result.ok, false);
    assert.equal(result.readyForHumanTriage, false);
    assert.match(result.errors.join("\n"), /route tracker, not a completed feedback packet/);
  });

  it("rejects issue bodies with secret-like content", async () => {
    const result = await auditTrialFeedbackIssue({
      issueNumber: 42,
      fetchIssue: async () => buildIssue({
        body: `${buildCompletedIssueBody()}\n\nAuthorization: Bearer leaked-token`
      })
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /secret-like content/);
  });

  it("rejects issue bodies that omit required Copilot evidence fields", async () => {
    const body = buildCompletedIssueBody()
      .replace("Prompt used: diagnose session readiness\n", "")
      .replace("Read-tool evidence observed: project and session status\n", "")
      .replace("Memory write proposal tested: skipped\n", "");
    const result = await auditTrialFeedbackIssue({
      issueNumber: 42,
      fetchIssue: async () => buildIssue({ body })
    });

    assert.equal(result.ok, false);
    assert.equal(result.readyForHumanTriage, false);
    assert.match(result.errors.join("\n"), /Copilot prompt used/);
    assert.match(result.errors.join("\n"), /Copilot read-tool evidence observed/);
    assert.match(result.errors.join("\n"), /Copilot memory write proposal tested/);
  });

  it("forwards repository and issue number to the live fetcher", async () => {
    let receivedOptions;
    const result = await auditTrialFeedbackIssue({
      repository: "Example/Repo",
      issueNumber: 77,
      fetchIssue: async (options) => {
        receivedOptions = options;
        return buildIssue({ number: 77, url: "https://example.test/issues/77" });
      }
    });

    assert.equal(result.ok, true);
    assert.deepEqual(receivedOptions, {
      repository: "Example/Repo",
      issueNumber: 77
    });
  });

  it("returns a structured failure when the issue cannot be read", async () => {
    const result = await auditTrialFeedbackIssue({
      issueNumber: 42,
      fetchIssue: async () => {
        throw new Error("gh auth required");
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.readyForHumanTriage, false);
    assert.equal(result.gateClearingEvidence, false);
    assert.match(result.errors.join("\n"), /could not be read: gh auth required/);
  });

  it("parses issue and repository CLI arguments", () => {
    assert.deepEqual(parseTrialFeedbackIssueAuditCliArgs(["--issue=42", "--repo=Example/Repo"]), {
      issueNumber: 42,
      repository: "Example/Repo"
    });

    assert.throws(() => parseTrialFeedbackIssueAuditCliArgs([]), /--issue/);
    assert.throws(() => parseTrialFeedbackIssueAuditCliArgs(["--issue=abc"]), /positive integer/);
    assert.throws(() => parseTrialFeedbackIssueAuditCliArgs(["--repo"]), /--repo=<owner\/name>/);
  });
});

function buildIssue(overrides = {}) {
  return {
    number: 42,
    title: "[Trial]: completed local smoke",
    state: "OPEN",
    labels: [{ name: "trial-feedback" }, { name: "product-hardening" }],
    body: buildCompletedIssueBody(),
    url: "https://example.test/issues/42",
    ...overrides
  };
}

function buildCompletedIssueBody() {
  return `### Trial result

pass with caveats

### Affected surface

terminal

### Startup path

source fallback

### Environment

ForgeBadger version or commit: abc1234
OS: linux x64 6.8.0
Shell: /bin/zsh
Browser: Chromium 125
node --version: v24.14.1
tmux -V: tmux 3.4
claude --version: 2.1.152

### forgebadger doctor summary

terminal native_tmux

### Startup and health checks

Command: pnpm --dir packages/gateway dev
Web URL: http://127.0.0.1:48732
Gateway URL: http://127.0.0.1:48731
Gateway health envelope: code 0
/login result: HTTP 200

### Core trial path

Account: local test user
Project/config: disposable project with Claude Code template
Claude Code session: created
Browser terminal attach: passed
Input/output: passed with harmless prompt
Resize: passed
Refresh/reconnect: passed
Stop: passed
Gateway/Web restart recovery: passed

### Copilot smoke evidence

pnpm smoke:copilot-provider result: skipped
Provider smoke skip or failure reason: missing_provider_credential
Provider with active model configured: skipped
Visible provider readiness blocker, if any: missing disposable credential
Prompt used: diagnose session readiness
Read-tool evidence observed: project and session status
Pending-action approve/reject result: skipped
Memory write proposal tested: skipped
Confirmed no terminal/shell/Codex turn input in Copilot: yes

### Mapped UX requirement

UX-01 dependency/runtime guidance

### Category

platform

### severity

medium

### Owner, disposition, and follow-up route

Owner: maintainer
Disposition: preserved caveat
Follow-up route: issue #4 WINDOWS-WSL
Next action or no-action rationale: rerun on physical Windows/WSL host
Evidence needed to move to pass: physical WSL terminal evidence

### Windows or WSL evidence

Native Windows management UI checked: not applicable
Native Windows doctor warning: not applicable
WSL distribution/version: not available
WSL terminal trial result: not run on physical WSL host

### Diagnostics and browser evidence

Diagnostics export attached: yes
Browser console error summary: none observed
Browser network failure summary: none observed
Screenshots or notes, redacted: attached separately

### Reproduction steps for each issue

1. Start Gateway and Web from source fallback.
2. Create a disposable project and Claude Code session.
3. Attach terminal, type a harmless prompt, resize, refresh, and stop.

Expected: Browser terminal remains attached after refresh and stopped session stays stopped.

Actual: Trial completed with caveat: no physical Windows/WSL host was available.

### Safety confirmation

- [x] I reviewed this issue and attachments for secrets before submitting.
- [x] Any API keys, passwords, JWTs, attach tokens, private keys, project secrets, and \`forgebadger.token\` values have been removed.
`;
}
