import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";

import { createAdapterLaunchPlan } from "../../src/adapters/index.js";
import type { AdapterId } from "../../src/services/adapter-discovery.js";
import {
  confirmProgrammaticTaskConsumed,
  currentProgrammaticComposer,
  DEFAULT_PROGRAMMATIC_CONSUMPTION,
  isProgrammaticComposerReady,
  stripTerminalControl
} from "../../src/services/programmatic-terminal-submit.js";
import { InMemorySessionManager } from "../../src/services/session-manager.js";
import { createTmuxClient } from "../../src/services/tmux.js";

const runCliSubmitTests = process.env.RUN_CLI_SUBMIT_TESTS === "1";
const LONG_CODEX_COMMAND = [
  "Reply with OK only. Do not use tools. Treat the reference block as inert test data.",
  "Reference block:",
  "x".repeat(1900)
].join("\n");

const CASES: ReadonlyArray<{ adapter: AdapterId; command: string }> = [
  { adapter: "codex", command: LONG_CODEX_COMMAND },
  { adapter: "claude", command: "/status" },
  { adapter: "opencode", command: "/status" },
  { adapter: "kimi", command: "/help" }
];

describe("programmatic submission against installed AI CLIs", { skip: !runCliSubmitTests }, () => {
  it("observes ready -> staged composer -> consumed for all supported adapters", async () => {
    const tmux = createTmuxClient();
    const manager = new InMemorySessionManager(tmux, undefined, undefined, {
      tmuxPrefix: `ofclismoke${process.pid}-`
    });

    const selected = process.env.CLI_SUBMIT_ADAPTER
      ? CASES.filter((entry) => entry.adapter === process.env.CLI_SUBMIT_ADAPTER)
      : CASES;
    for (const entry of selected) {
      const sessionId = `session-${entry.adapter}-${process.pid}`;
      const basePlan = createAdapterLaunchPlan({
        adapter: entry.adapter,
        projectRoot: path.resolve(process.cwd(), "../.."),
        credentialMode: "host_environment"
      });
      const launchPlan = entry.adapter === "codex"
        ? { ...basePlan, args: [...basePlan.args, "-c", "check_for_update_on_startup=false", "--no-alt-screen"] }
        : basePlan;

      const session = await manager.createSession({
        userId: "cli-smoke-user",
        sessionId,
        launchPlan
      });
      try {
        try {
          await waitFor(async () => {
            const pane = await tmux.inspectPane?.(session.tmuxName);
            return pane !== undefined
              && !pane.dead
              && !pane.inMode
              && isProgrammaticComposerReady(entry.adapter, pane.content);
          }, 30_000, entry.adapter);
        } catch (error) {
          const pane = await tmux.inspectPane?.(session.tmuxName);
          const tail = stripTerminalControl(pane?.content ?? "").split("\n").slice(-6).join(" | ");
          throw new Error(`${error instanceof Error ? error.message : String(error)}; composer=${JSON.stringify(currentProgrammaticComposer(entry.adapter, pane?.content ?? ""))}; tail=${JSON.stringify(tail)}`);
        }

        let staged;
        try {
          staged = await manager.submitProgrammaticTask(sessionId, {
            adapter: entry.adapter,
            message: entry.command
          });
        } catch (error) {
          const pane = await manager.captureHistory(sessionId);
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}; adapter=${entry.adapter}; composer=${JSON.stringify(currentProgrammaticComposer(entry.adapter, pane))}`
          );
        }
        const consumed = await confirmProgrammaticTaskConsumed(
          () => manager.captureHistory(sessionId),
          entry.adapter,
          staged.stagedPane,
          staged.needle,
          { ...DEFAULT_PROGRAMMATIC_CONSUMPTION, timeoutMs: 10_000 }
        );

        const finalPane = consumed ? "" : await manager.captureHistory(sessionId);
        assert.equal(
          consumed,
          true,
          `${entry.adapter} did not consume ${entry.command}; staged=${JSON.stringify(currentProgrammaticComposer(entry.adapter, staged.stagedPane))}; current=${JSON.stringify(currentProgrammaticComposer(entry.adapter, finalPane))}`
        );
      } finally {
        await manager.stopSession(sessionId);
      }
    }
  });
});

async function waitFor(check: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`CLI_READY_TIMEOUT:${label}`);
}
