import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTrialFeedbackDraft,
  collectTrialFeedbackDraftContext,
  parseDraftCliArgs,
  sanitizeDraftText
} from "./create-trial-feedback-draft.mjs";

describe("trial feedback draft generator", () => {
  it("builds a safe first-user packet draft without claiming external gates passed", () => {
    const draft = buildTrialFeedbackDraft({
      commit: "abc1234",
      os: "linux x64 6.8.0",
      shell: "/bin/zsh",
      nodeVersion: "v24.14.1",
      tmuxVersion: "tmux 3.4",
      claudeVersion: "2.1.152",
      startupPath: "source fallback",
      webUrl: "http://127.0.0.1:48732",
      gatewayUrl: "http://127.0.0.1:48731"
    });

    assert.match(draft, /# OpenForge Trial Feedback Draft/);
    assert.match(draft, /Generated draft status: not submitted, not reviewed, not gate-clearing evidence/);
    assert.match(draft, /OpenForge version or commit: abc1234/);
    assert.match(draft, /Startup path: source fallback/);
    assert.match(draft, /Gateway URL: http:\/\/127\.0\.0\.1:48731/);
    assert.match(draft, /Copilot memory write proposal tested: yes \/ no \/ skipped/);
    assert.match(draft, /`LIVE-PROVIDER`: Caveat/);
    assert.match(draft, /`FIRST-USER-FEEDBACK`: Caveat until this packet is completed, redacted, and linked/);
    assert.match(draft, /Redaction review completed: no/);
    assert.doesNotMatch(draft, /\bPass\b.*LIVE-PROVIDER/);
  });

  it("redacts token-shaped values from generated drafts", () => {
    const draft = buildTrialFeedbackDraft({
      commit: "abc1234",
      shell: "Bearer secret-token-value",
      nodeVersion: "sk-test-secret",
      tmuxVersion: "openforge.token=secret",
      claudeVersion: "OPENFORGE_MASTER_KEY=abc123"
    });

    assert.doesNotMatch(draft, /secret-token-value/);
    assert.doesNotMatch(draft, /sk-test-secret/);
    assert.doesNotMatch(draft, /openforge\.token=secret/);
    assert.doesNotMatch(draft, /OPENFORGE_MASTER_KEY=abc123/);
    assert.match(draft, /\[redacted\]/);
  });

  it("collects bounded local context through injected command runners", () => {
    const context = collectTrialFeedbackDraftContext({
      env: { SHELL: "/bin/bash" },
      platform: "linux",
      arch: "x64",
      release: "6.8.0",
      nodeVersion: "v24.14.1",
      commandRunner(command, args) {
        const joined = [command, ...args].join(" ");
        return {
          "git rev-parse --short HEAD": { status: 0, stdout: "abc1234\n" },
          "tmux -V": { status: 0, stdout: "tmux 3.4\n" },
          "claude --version": { status: 0, stdout: "2.1.152\n" },
          "opencode --version": { status: 1, stderr: "missing\n" },
          "codex --version": { status: 0, stdout: "codex 0.134.0\n" }
        }[joined] ?? { status: 127, stderr: "not found\n" };
      }
    });

    assert.equal(context.commit, "abc1234");
    assert.equal(context.os, "linux x64 6.8.0");
    assert.equal(context.shell, "/bin/bash");
    assert.equal(context.tmuxVersion, "tmux 3.4");
    assert.equal(context.claudeVersion, "2.1.152");
    assert.equal(context.opencodeVersion, "unavailable");
    assert.equal(context.codexVersion, "codex 0.134.0");
  });

  it("parses output path and default URLs without accepting unknown flags", () => {
    assert.deepEqual(parseDraftCliArgs([
      "--",
      "--output",
      "/tmp/trial.md",
      "--startup-path",
      "npm/CLI",
      "--web-url",
      "http://127.0.0.1:48732",
      "--gateway-url",
      "http://127.0.0.1:48731"
    ]), {
      outputPath: "/tmp/trial.md",
      startupPath: "npm/CLI",
      webUrl: "http://127.0.0.1:48732",
      gatewayUrl: "http://127.0.0.1:48731"
    });

    assert.throws(() => parseDraftCliArgs(["--bad"]), /Unknown argument/);
  });

  it("sanitizes multiline command output to a bounded single line", () => {
    assert.equal(sanitizeDraftText("one\ntwo\nthree", { fallback: "n/a" }), "one");
    assert.equal(sanitizeDraftText("", { fallback: "n/a" }), "n/a");
  });
});
