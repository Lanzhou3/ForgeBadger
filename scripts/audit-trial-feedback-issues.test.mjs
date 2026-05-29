import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  auditTrialFeedbackIssues,
  parseTrialFeedbackIssuesAuditCliArgs
} from "./audit-trial-feedback-issues.mjs";

describe("trial feedback GitHub issue candidate audit", () => {
  it("skips route tracker issues and reports no completed feedback candidates", async () => {
    const audited = [];
    const result = await auditTrialFeedbackIssues({
      fetchIssues: async () => [
        buildIssue({ number: 4, title: "Run physical Windows and WSL OpenForge smoke" }),
        buildIssue({ number: 5, title: "Collect first-user Copilot hardening feedback" })
      ],
      auditIssue: async (options) => {
        audited.push(options.issueNumber);
        return { ok: true };
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.gateClearingEvidence, false);
    assert.deepEqual(result.trackerIssueNumbers, [4, 5]);
    assert.deepEqual(result.candidateIssueNumbers, []);
    assert.deepEqual(result.readyIssueNumbers, []);
    assert.deepEqual(result.blockedIssueNumbers, []);
    assert.deepEqual(audited, []);
    assert.match(result.nextSteps.join("\n"), /No completed feedback candidate issues found/);
  });

  it("audits non-tracker feedback issues and summarizes ready versus blocked candidates", async () => {
    const receivedOptions = [];
    const result = await auditTrialFeedbackIssues({
      repository: "Example/Repo",
      limit: 25,
      fetchIssues: async (options) => {
        assert.deepEqual(options, { repository: "Example/Repo", limit: 25 });
        return [
          buildIssue({ number: 5, title: "Collect first-user Copilot hardening feedback" }),
          buildIssue({ number: 42, title: "[Trial]: completed local smoke" }),
          buildIssue({ number: 43, title: "[Trial]: incomplete diagnostics" })
        ];
      },
      auditIssue: async (options) => {
        receivedOptions.push(options);
        if (options.issueNumber === 42) {
          return {
            ok: true,
            readyForHumanTriage: true,
            gateClearingEvidence: false,
            issue: buildIssue({ number: 42, title: "[Trial]: completed local smoke" }),
            errors: [],
            warnings: ["ready for triage, not gate clearing"]
          };
        }
        return {
          ok: false,
          readyForHumanTriage: false,
          gateClearingEvidence: false,
          issue: buildIssue({ number: 43, title: "[Trial]: incomplete diagnostics" }),
          errors: ["Missing required field value: Diagnostics export attached"],
          warnings: []
        };
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.gateClearingEvidence, false);
    assert.deepEqual(result.trackerIssueNumbers, [5]);
    assert.deepEqual(result.candidateIssueNumbers, [42, 43]);
    assert.deepEqual(result.readyIssueNumbers, [42]);
    assert.deepEqual(result.blockedIssueNumbers, [43]);
    assert.deepEqual(receivedOptions, [
      { repository: "Example/Repo", issueNumber: 42 },
      { repository: "Example/Repo", issueNumber: 43 }
    ]);
    assert.match(result.errors.join("\n"), /#43.*Diagnostics export attached/);
    assert.match(result.nextSteps.join("\n"), /Run pnpm trial:feedback-issue-audit -- --issue=43/);
  });

  it("fails safely when GitHub issues cannot be listed", async () => {
    const result = await auditTrialFeedbackIssues({
      fetchIssues: async () => {
        throw new Error("gh auth required");
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.gateClearingEvidence, false);
    assert.match(result.errors.join("\n"), /could not be listed: gh auth required/);
  });

  it("parses repository and limit CLI arguments", () => {
    assert.deepEqual(parseTrialFeedbackIssuesAuditCliArgs(["--repo=Example/Repo", "--limit=25"]), {
      repository: "Example/Repo",
      limit: 25
    });

    assert.deepEqual(parseTrialFeedbackIssuesAuditCliArgs([]), {
      repository: undefined,
      limit: 50
    });

    assert.throws(() => parseTrialFeedbackIssuesAuditCliArgs(["--repo"]), /--repo=<owner\/name>/);
    assert.throws(() => parseTrialFeedbackIssuesAuditCliArgs(["--limit=0"]), /positive integer/);
    assert.throws(() => parseTrialFeedbackIssuesAuditCliArgs(["--limit"]), /--limit=<number>/);
  });
});

function buildIssue(overrides = {}) {
  return {
    number: 42,
    title: "[Trial]: completed local smoke",
    state: "OPEN",
    labels: [{ name: "trial-feedback" }, { name: "product-hardening" }],
    url: `https://example.test/issues/${overrides.number ?? 42}`,
    ...overrides
  };
}
