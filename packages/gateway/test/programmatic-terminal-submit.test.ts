import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertSafeProgrammaticMessage,
  composerContainsStagedTask,
  composerContainsNeedle,
  currentProgrammaticComposer,
  isProgrammaticComposerReady,
  isProgrammaticTaskConsumed,
  programmaticDeliveryNeedle
} from "../src/services/programmatic-terminal-submit.js";

const READY_PANES = {
  codex: "› Ask Codex to do anything\n\n  gpt-5.6-sol · ~/Project/ForgeBadger",
  claude: "Claude Code v2.1.239\n────────────────\n❯  \n────────────────\nauto mode on",
  opencode: "┃ Ask anything... \"Fix a TODO in the codebase\"\n┃ Build · model\nctrl+p commands",
  kimi: "│ >                                                                        │\nauto  K3 thinking: high  context: 0%",
  pi: "  ──────────────────────────────────────────\n  /app/workspace/project\n  0.0%/262k (auto)"
} as const;

const STAGED_PANES = {
  codex: "› 修复登录流程\n\n  gpt-5.6-sol · ~/Project/ForgeBadger",
  claude: "Claude Code v2.1.239\n────────────────\n❯ 修复登录流程\n────────────────\nauto mode on",
  opencode: "┃ 修复登录流程\n┃ Build · model\nctrl+p commands",
  kimi: "│ > 修复登录流程                                                           │\nauto  K3 thinking: high  context: 0%",
  pi: "  ──────────────────────────────────────────\n  /app/workspace/project\n  0.0%/262k (auto)\n  修复登录流程"
} as const;

describe("programmatic terminal submit classifiers", () => {
  it("accepts Unicode, tabs, and newlines in programmatic task text", () => {
    assert.doesNotThrow(() => assertSafeProgrammaticMessage("修复登录流程\n\t保留缩进"));
  });

  it("rejects control characters that can escape bracketed paste", () => {
    for (const message of [
      "hello\u001b[201~\rInjected command",
      "nul\u0000byte",
      "c1\u0085control"
    ]) {
      assert.throws(
        () => assertSafeProgrammaticMessage(message),
        /PROGRAMMATIC_SUBMIT_UNSAFE_INPUT/
      );
    }
  });

  for (const adapter of ["codex", "claude", "opencode", "kimi", "pi"] as const) {
    it(`recognizes an empty ${adapter} composer as ready`, () => {
      assert.equal(isProgrammaticComposerReady(adapter, READY_PANES[adapter]), true);
    });

    it(`finds staged input only in the current ${adapter} composer`, () => {
      const needle = programmaticDeliveryNeedle("修复登录流程");
      assert.equal(composerContainsNeedle(adapter, STAGED_PANES[adapter], needle), true);
      assert.equal(
        composerContainsNeedle(adapter, `修复登录流程\n${READY_PANES[adapter]}`, needle),
        false,
        "scrollback text must not be treated as current composer input"
      );
    });
  }

  it("does not treat shell, modal, busy, or unknown panes as ready for any adapter", () => {
    for (const adapter of ["codex", "claude", "opencode", "kimi", "pi"] as const) {
      for (const pane of ["bash-3.2$", "Trust this workspace? [y/N]", "Working… esc to interrupt", "unknown screen"]) {
        assert.equal(isProgrammaticComposerReady(adapter, pane), false, `${adapter}: ${pane}`);
      }
    }
  });

  it("keeps the PI composer blocked while the agent is working or the paste is folded", () => {
    // Live-measured busy layout: the spinner bar sits in the box-bar slot
    // above the cwd line; the status line stays the pane's last line.
    const busyPane = "  ── ⠦ Working ───────────────────────────────\n  \n  ──────────────────────────────────────────\n  /app/workspace/project\n  5.5%/262k (auto)";
    assert.equal(isProgrammaticComposerReady("pi", busyPane), false, "PI Working spinner bar");
    const foldedPane = "  /app/workspace/project\n  12.1%/262k (auto)\n  ↑ 120 more\n  2234";
    assert.equal(isProgrammaticComposerReady("pi", foldedPane), false, "PI paste fold hides the full composer");
    assert.equal(currentProgrammaticComposer("pi", foldedPane), "2234");
  });

  it("ignores stale spinner frames from earlier turns in PI scrollback", () => {
    // Real capturePane output is ~500 lines of scrollback + the current
    // screen: earlier turns' spinner frames sit far above the live footer.
    const stale = [
      "  Working ───────────────────────────────────",
      "  ⠙ Working ─────────────────────",
      "  old turn content line one",
      "  old turn content line two",
      "  current turn content line",
      READY_PANES.pi
    ].join("\n");
    assert.equal(isProgrammaticComposerReady("pi", stale), true);
    assert.equal(currentProgrammaticComposer("pi", stale), "");
  });

  it("does not read PI scrollback above the composer box as staged input", () => {
    const needle = programmaticDeliveryNeedle("修复登录流程");
    const pane = `修复登录流程\n${READY_PANES.pi}`;
    assert.equal(composerContainsNeedle("pi", pane, needle), false);
    assert.equal(isProgrammaticComposerReady("pi", pane), true);
  });

  it("requires a changed pane and removal from the current composer", () => {
    const needle = programmaticDeliveryNeedle("修复登录流程");
    assert.equal(
      isProgrammaticTaskConsumed("codex", STAGED_PANES.codex, STAGED_PANES.codex, needle),
      false,
      "unchanged composer is the Codex paste-burst failure"
    );
    assert.equal(
      isProgrammaticTaskConsumed(
        "codex",
        STAGED_PANES.codex,
        `修复登录流程\n${READY_PANES.codex}`,
        needle
      ),
      true,
      "the same text in scrollback is allowed once the current composer cleared"
    );
    const busyPane = `${STAGED_PANES.codex}\n  tab to queue message · 100% context left`;
    assert.equal(
      currentProgrammaticComposer("codex", busyPane),
      "",
      "a Codex busy footer classifies the visible user turn as scrollback, not composer input"
    );
    assert.equal(composerContainsNeedle("codex", busyPane, needle), false);
    assert.equal(isProgrammaticTaskConsumed("codex", STAGED_PANES.codex, busyPane, needle), true);
  });

  it("recognizes Codex's current-composer placeholder for a large Unicode paste", () => {
    const message = "🙂".repeat(1001);
    const pane = "› [Pasted Content 1001 chars]\n\nmodel · cwd";
    const needle = programmaticDeliveryNeedle(message);

    assert.equal(composerContainsStagedTask("codex", pane, message, needle), true);
    assert.equal(
      composerContainsStagedTask("codex", "› [Pasted Content 2002 chars]", message, needle),
      false,
      "Codex counts Unicode scalar values, not UTF-16 code units"
    );
  });
});
