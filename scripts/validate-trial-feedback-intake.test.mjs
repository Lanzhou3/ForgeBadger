import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  REQUIRED_GITHUB_FIELD_TYPES,
  REQUIRED_GITHUB_FIELDS,
  REQUIRED_GITHUB_OPTIONS,
  REQUIRED_CAVEAT_OWNER_PHRASES,
  REQUIRED_MARKDOWN_PHRASES,
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
        "id: copilot\n    validations:\n      required: true",
        "id: copilot\n    validations:\n      required: false"
      );
    const markdownTemplate = buildMarkdownTemplateFixture();

    const result = validateTrialFeedbackIntake({
      githubIssueForm,
      markdownTemplate
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /result.*blocked/);
    assert.match(result.errors.join("\n"), /copilot.*required: true/);
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
      "# OpenForge First-User Trial Runbook",
      "## Diagnostics",
      "Export diagnostics from the local Gateway after logging in:",
      "curl -H \"authorization: Bearer <token>\" http://127.0.0.1:48731/api/v1/diagnostics/export",
      "Open browser developer tools for the OpenForge Web console.",
      "Read Local Storage and use the `openforge.token` value."
    ].join("\n");

    const result = validateTrialFeedbackIntake({
      githubIssueForm,
      markdownTemplate,
      trialRunbook
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /first-user runbook.*browser developer tools/);
    assert.match(result.errors.join("\n"), /first-user runbook.*openforge\.token/);
  });

  it("rejects checklist drift that removes gate-routing commands or asks for browser tokens", () => {
    const githubIssueForm = buildIssueFormFixture();
    const markdownTemplate = buildMarkdownTemplateFixture();
    const trialRunbook = buildTrialRunbookFixture();
    const trialChecklist = [
      "# OpenForge Trial Checklist",
      "Use this checklist as the first-user trial entry point.",
      "Read browser developer tools and copy the `openforge.token` value into the handoff.",
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
    assert.match(result.errors.join("\n"), /trial checklist.*pnpm evidence:gates-validate/);
    assert.match(result.errors.join("\n"), /trial checklist.*browser developer tools/);
    assert.match(result.errors.join("\n"), /trial checklist.*openforge\.token/);
  });
});

function buildIssueFormFixture() {
  const body = [
    "name: OpenForge first-user trial feedback",
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
  return `${body.join("\n")}\n`;
}

function buildTrialRunbookFixture() {
  return [
    "# OpenForge First-User Trial Runbook",
    "Open Settings.",
    "Click **Export diagnostics JSON**.",
    "Do not ask first users to retrieve browser auth tokens from developer tools.",
    "Maintainer-only fallback"
  ].join("\n");
}
