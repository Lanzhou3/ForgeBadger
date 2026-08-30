import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  REQUIRED_GITHUB_FIELD_TYPES,
  REQUIRED_GITHUB_FIELDS,
  REQUIRED_GITHUB_OPTIONS,
  REQUIRED_CAVEAT_OWNER_PHRASES,
  REQUIRED_GITHUB_PORTFOLIO_PROMPTS,
  REQUIRED_MARKDOWN_PHRASES,
  REQUIRED_MARKDOWN_PORTFOLIO_PROMPTS,
  REQUIRED_MARKDOWN_SECTIONS,
  REQUIRED_SAFETY_PHRASES,
  validateTrialFeedbackIntake
} from "./validate-trial-feedback-intake.mjs";

describe("validateTrialFeedbackIntake", () => {
  it("accepts the checked-in trial feedback intake contract", async () => {
    const result = await validateTrialFeedbackIntake();

    assert.deepEqual(result, { ok: true, errors: [] });
  });

  it("rejects missing required GitHub issue fields", async () => {
    const githubIssueForm = buildIssueFormFixture().replace("id: diagnostics", "id: diagnostic_notes");
    const markdownTemplate = buildMarkdownTemplateFixture();

    const result = validateTrialFeedbackIntake({
      githubIssueForm,
      markdownTemplate
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /diagnostics/);
  });

  it("rejects GitHub option and required-flag drift", () => {
    const githubIssueForm = buildIssueFormFixture()
      .replace("        - blocked", "        - blocked externally")
      .replace(
        "        Confirmed no terminal/shell/Codex turn input in Portfolio:\n    validations:\n      required: true",
        "        Confirmed no terminal/shell/Codex turn input in Portfolio:\n    validations:\n      required: false"
      );
    const markdownTemplate = buildMarkdownTemplateFixture();

    const result = validateTrialFeedbackIntake({
      githubIssueForm,
      markdownTemplate
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /result.*blocked/);
    assert.match(result.errors.join("\n"), /portfolio.*required: true/);
  });

  it("rejects trial intake drift back to the old Feishu callback evidence route", () => {
    const githubIssueForm = buildIssueFormFixture().replace(
      "FEISHU-BOT-WS evidence",
      "Feishu callback evidence report"
    );
    const markdownTemplate = buildMarkdownTemplateFixture().replace(
      "FEISHU-BOT-WS evidence",
      "Feishu callback evidence report"
    );
    const trialChecklist = buildTrialChecklistFixture().replace("`FEISHU-BOT-WS`", "`FEISHU-CALLBACK`");

    const result = validateTrialFeedbackIntake({
      githubIssueForm,
      markdownTemplate,
      trialRunbook: buildTrialRunbookFixture(),
      trialChecklist
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /FEISHU-BOT-WS evidence/);
    assert.match(result.errors.join("\n"), /trial checklist.*`FEISHU-BOT-WS`/);
  });

  it("rejects GitHub field type drift", () => {
    const githubIssueForm = buildIssueFormFixture().replace(
      "- type: checkboxes\n    id: safety",
      "- type: textarea\n    id: safety"
    );
    const markdownTemplate = buildMarkdownTemplateFixture();

    const result = validateTrialFeedbackIntake({
      githubIssueForm,
      markdownTemplate
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /safety.*checkboxes/);
  });

  it("rejects missing Markdown sections and safety language", () => {
    const githubIssueForm = buildIssueFormFixture();
    const markdownTemplate = buildMarkdownTemplateFixture()
      .replace("## Diagnostics Export", "## Diagnostics")
      .replace("Do not include plaintext API keys", "Never include plaintext API keys");

    const result = validateTrialFeedbackIntake({
      githubIssueForm,
      markdownTemplate
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /Diagnostics Export/);
    assert.match(result.errors.join("\n"), /Do not include plaintext API keys/);
  });

  it("rejects public intake language that asks users to paste unsafe raw evidence", () => {
    const githubIssueForm = buildIssueFormFixture().replace(
      "Do not paste API keys",
      "Paste raw provider payloads and your API key"
    );
    const markdownTemplate = buildMarkdownTemplateFixture();

    const result = validateTrialFeedbackIntake({
      githubIssueForm,
      markdownTemplate
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /unsafe intake language/);
  });

  it("rejects first-user runbook guidance that asks users to retrieve browser tokens", () => {
    const githubIssueForm = buildIssueFormFixture();
    const markdownTemplate = buildMarkdownTemplateFixture();
    const trialRunbook = [
      "# ForgeBadger First-User Trial Runbook",
      "## Diagnostics",
      "Export diagnostics from the local Gateway after logging in:",
      "curl -H \"authorization: Bearer <token>\" http://127.0.0.1:48731/api/v1/diagnostics/export",
      "Open browser developer tools for the ForgeBadger Web console.",
      "Read Local Storage and use the `forgebadger.token` value."
    ].join("\n");

    const result = validateTrialFeedbackIntake({
      githubIssueForm,
      markdownTemplate,
      trialRunbook
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /first-user runbook.*browser developer tools/);
    assert.match(result.errors.join("\n"), /first-user runbook.*forgebadger\.token/);
  });

  it("rejects checklist drift that removes gate-routing commands or asks for browser tokens", () => {
    const githubIssueForm = buildIssueFormFixture();
    const markdownTemplate = buildMarkdownTemplateFixture();
    const trialRunbook = buildTrialRunbookFixture();
    const trialChecklist = [
      "# ForgeBadger Trial Checklist",
      "Use this checklist as the first-user trial entry point.",
      "Read browser developer tools and copy the `forgebadger.token` value into the handoff.",
      "Feedback capture is complete after a maintainer reads the packet."
    ].join("\n");

    const result = validateTrialFeedbackIntake({
      githubIssueForm,
      markdownTemplate,
      trialRunbook,
      trialChecklist
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /trial checklist.*pnpm trial:intake-validate/);
    assert.match(result.errors.join("\n"), /trial checklist.*pnpm trial:issue-routes-validate/);
    assert.match(result.errors.join("\n"), /trial checklist.*pnpm trial:readiness-validate/);
    assert.match(result.errors.join("\n"), /trial checklist.*pnpm trial:feedback-audit/);
    assert.match(result.errors.join("\n"), /trial checklist.*pnpm trial:feedback-issue-audit/);
    assert.match(result.errors.join("\n"), /trial checklist.*pnpm trial:feedback-issues-audit/);
    assert.match(result.errors.join("\n"), /trial checklist.*pnpm evidence:gates-validate/);
    assert.match(result.errors.join("\n"), /trial checklist.*pnpm evidence:feishu-bot-live-audit/);
    assert.match(result.errors.join("\n"), /trial checklist.*pnpm evidence:feishu-bot-live-report/);
    assert.match(result.errors.join("\n"), /trial checklist.*browser developer tools/);
    assert.match(result.errors.join("\n"), /trial checklist.*forgebadger\.token/);
  });

  it("rejects first-user entrypoint docs that omit feedback audit routes", () => {
    const result = validateTrialFeedbackIntake({
      githubIssueForm: buildIssueFormFixture(),
      markdownTemplate: buildMarkdownTemplateFixture(),
      trialRunbook: buildTrialRunbookFixture(),
      trialChecklist: buildTrialChecklistFixture(),
      openSourceReadiness: [
        "# Open Source Readiness",
        "Use `.github/ISSUE_TEMPLATE/forgebadger-trial-feedback.yml` or `docs/TRIAL-FEEDBACK.md`."
      ].join("\n"),
      supportDiagnostics: [
        "# Support Diagnostics",
        "Use docs/EXTERNAL-EVIDENCE-GATES.md gate FIRST-USER-FEEDBACK for the required packet shape."
      ].join("\n")
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /open-source readiness.*pnpm trial:feedback-audit/);
    assert.match(result.errors.join("\n"), /open-source readiness.*pnpm trial:feedback-issue-audit/);
    assert.match(result.errors.join("\n"), /support diagnostics.*pnpm trial:feedback-audit/);
    assert.match(result.errors.join("\n"), /support diagnostics.*pnpm trial:feedback-issue-audit/);
  });

  it("rejects first-user docs that omit bulk GitHub feedback candidate audit guidance", () => {
    const result = validateTrialFeedbackIntake({
      githubIssueForm: buildIssueFormFixture(),
      markdownTemplate: buildMarkdownTemplateFixture(),
      trialRunbook: buildTrialRunbookFixture(),
      trialChecklist: buildTrialChecklistFixture(),
      openSourceReadiness: buildFirstUserEntrypointFixture().replace(
        "pnpm trial:feedback-issues-audit\n",
        ""
      ),
      supportDiagnostics: buildFirstUserEntrypointFixture().replace(
        "pnpm trial:feedback-issues-audit\n",
        ""
      )
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /open-source readiness.*pnpm trial:feedback-issues-audit/);
    assert.match(result.errors.join("\n"), /support diagnostics.*pnpm trial:feedback-issues-audit/);
  });

  it("rejects README trial entrypoints that omit the GitHub feedback issue form", () => {
    const result = validateTrialFeedbackIntake({
      githubIssueForm: buildIssueFormFixture(),
      markdownTemplate: buildMarkdownTemplateFixture(),
      trialRunbook: buildTrialRunbookFixture(),
      trialChecklist: buildTrialChecklistFixture(),
      openSourceReadiness: buildFirstUserEntrypointFixture(),
      supportDiagnostics: buildFirstUserEntrypointFixture(),
      rootReadme: [
        "# ForgeBadger",
        "## First User Trial",
        "- [Trial runbook](docs/TRIAL-RUNBOOK.md)",
        "- [Trial checklist](docs/TRIAL-CHECKLIST.md)",
        "- [Troubleshooting](docs/TROUBLESHOOTING.md)",
        "- [Trial feedback template](docs/TRIAL-FEEDBACK.md)"
      ].join("\n")
    });

    assert.equal(result.ok, false);
    assert.match(
      result.errors.join("\n"),
      /root README.*\.github\/ISSUE_TEMPLATE\/forgebadger-trial-feedback\.yml/
    );
  });

  it("rejects intake materials that omit Portfolio evidence prompts", () => {
    const result = validateTrialFeedbackIntake({
      githubIssueForm: buildIssueFormFixture().replaceAll("Portfolio route availability:", "Portfolio route:"),
      markdownTemplate: buildMarkdownTemplateFixture().replaceAll(
        "Portfolio route availability:",
        "Portfolio route:"
      ),
      trialRunbook: buildTrialRunbookFixture(),
      trialChecklist: buildTrialChecklistFixture(),
      openSourceReadiness: buildFirstUserEntrypointFixture(),
      supportDiagnostics: buildFirstUserEntrypointFixture()
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /GitHub issue form.*Portfolio route availability:/);
    assert.match(result.errors.join("\n"), /Markdown trial feedback template.*Portfolio route availability:/);
  });
});

function buildIssueFormFixture() {
  const body = [
    "name: ForgeBadger first-user trial feedback",
    "labels:",
    "  - trial-feedback",
    "body:"
  ];
  for (const field of REQUIRED_GITHUB_FIELDS) {
    body.push(`  - type: ${REQUIRED_GITHUB_FIELD_TYPES[field]}`);
    body.push(`    id: ${field}`);
    if (REQUIRED_GITHUB_OPTIONS[field]) {
      body.push("    attributes:");
      body.push("      options:");
      for (const option of REQUIRED_GITHUB_OPTIONS[field]) {
        body.push(`        - ${option}`);
      }
    } else if (field === "portfolio") {
      body.push("    attributes:");
      body.push("      value: |");
      for (const phrase of REQUIRED_GITHUB_PORTFOLIO_PROMPTS) body.push(`        ${phrase}`);
    } else if (field === "safety") {
      body.push("    attributes:");
      body.push("      options:");
      for (const phrase of REQUIRED_SAFETY_PHRASES.github) {
        body.push(`        - label: ${phrase}`);
        body.push("          required: true");
      }
    }
    if (field !== "safety") {
      body.push("    validations:");
      body.push(`      required: ${field === "windows_wsl" ? "false" : "true"}`);
    }
  }
  for (const phrase of REQUIRED_CAVEAT_OWNER_PHRASES) {
    body.push(phrase);
  }
  return `${body.join("\n")}\n`;
}

function buildMarkdownTemplateFixture() {
  const body = [];
  for (const section of REQUIRED_MARKDOWN_SECTIONS) {
    body.push(`## ${section}`);
    body.push("");
  }
  for (const phrase of REQUIRED_SAFETY_PHRASES.markdown) {
    body.push(phrase);
  }
  for (const phrase of REQUIRED_MARKDOWN_PHRASES) {
    body.push(phrase);
  }
  for (const phrase of REQUIRED_MARKDOWN_PORTFOLIO_PROMPTS) body.push(phrase);
  return `${body.join("\n")}\n`;
}

function buildTrialRunbookFixture() {
  return [
    "# ForgeBadger First-User Trial Runbook",
    "Open Settings.",
    "Click **Export diagnostics JSON**.",
    "Do not ask first users to retrieve browser auth tokens from developer tools.",
    "Maintainer-only fallback"
  ].join("\n");
}

function buildTrialChecklistFixture() {
  return [
    "# ForgeBadger Trial Checklist",
    "Use this checklist as the first-user trial entry point.",
    "docs/EXTERNAL-EVIDENCE-GATES.md",
    "`pnpm trial:intake-validate`",
    "`pnpm trial:issue-routes-validate`",
    "`pnpm trial:readiness-validate`",
    "`pnpm trial:feedback-audit -- /tmp/forgebadger-trial-feedback.md`",
    "`pnpm trial:feedback-issue-audit -- --issue=<number>`",
    "`pnpm trial:feedback-issues-audit`",
    "`pnpm evidence:gates-validate`",
    "--output <report.json>",
    "`pnpm evidence:feishu-bot-live-audit -- <report.json>`",
    "`pnpm evidence:feishu-bot-live-report -- --report <report.json> --output <report.md>`",
    "`FEISHU-BOT-WS`",
    "Feishu Bot Long-Connection Smoke",
    "`FIRST-USER-FEEDBACK`",
    "Templates and empty issue forms do not count as completed feedback.",
    "Follow-up route, phase, or issue:",
    "Redaction review completed:"
  ].join("\n");
}

function buildFirstUserEntrypointFixture() {
  return [
    "docs/TRIAL-FEEDBACK.md",
    ".github/ISSUE_TEMPLATE/forgebadger-trial-feedback.yml",
    "pnpm trial:feedback-audit",
    "pnpm trial:feedback-issue-audit",
    "pnpm trial:feedback-issues-audit",
    "FIRST-USER-FEEDBACK"
  ].join("\n");
}
