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
  codex: "› Ask Codex to do anything\n\n  gpt-5.6-sol · ~/Project/OpenForge",
  claude: "Claude Code v2.1.239\n────────────────\n❯  \n────────────────\nauto mode on",
  opencode: "┃ Ask anything... \"Fix a TODO in the codebase\"\n┃ Build · model\nctrl+p commands",
  kimi: "│ >                                                                        │\nauto  K3 thinking: high  context: 0%"
} as const;

const STAGED_PANES = {
  codex: "› 修复登录流程\n\n  gpt-5.6-sol · ~/Project/OpenForge",
  claude: "Claude Code v2.1.239\n────────────────\n❯ 修复登录流程\n────────────────\nauto mode on",
  opencode: "┃ 修复登录流程\n┃ Build · model\nctrl+p commands",
  kimi: "│ > 修复登录流程                                                           │\nauto  K3 thinking: high  context: 0%"
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

  for (const adapter of ["codex", "claude", "opencode", "kimi"] as const) {
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
    for (const adapter of ["codex", "claude", "opencode", "kimi"] as const) {
      for (const pane of ["bash-3.2$", "Trust this workspace? [y/N]", "Working… esc to interrupt", "unknown screen"]) {
        assert.equal(isProgrammaticComposerReady(adapter, pane), false, `${adapter}: ${pane}`);
      }
    }
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
