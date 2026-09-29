import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import { ensureMcodeNotificationPreference } from "../src/services/mcode-notification-preference.js";
import { TerminalNotificationScanner } from "../src/services/session-server/terminal-notification-scanner.js";

const tempDirs: string[] = [];

async function tempDataDir(config?: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "fb-mcode-notify-"));
  tempDirs.push(dir);
  if (config !== undefined) {
    await writeFile(path.join(dir, "config.yaml"), config, "utf8");
  }
  return dir;
}

function options(dir: string) {
  return { env: { MINIMAX_DATA_DIR: dir }, homeDir: dir };
}

async function readConfig(dir: string): Promise<Record<string, unknown>> {
  return parseYaml(await readFile(path.join(dir, "config.yaml"), "utf8")) as Record<string, unknown>;
}

describe("mcode terminal notification preference", () => {
  it("pins osc9 when the preference is absent", async () => {
    const dir = await tempDataDir("logLevel: info\ndefaultModel: minimax/MiniMax-M3\n");

    const result = ensureMcodeNotificationPreference(options(dir));

    assert.equal(result.changed, true);
    const doc = await readConfig(dir);
    assert.deepEqual(doc.notifications, { method: "osc9" });
    // Untouched keys survive.
    assert.equal(doc.logLevel, "info");
    assert.equal(doc.defaultModel, "minimax/MiniMax-M3");
  });

  it("upgrades auto to osc9", async () => {
    const dir = await tempDataDir("notifications:\n  method: auto\n  when: unfocused\n");

    assert.equal(ensureMcodeNotificationPreference(options(dir)).changed, true);
    const doc = await readConfig(dir);
    // Only `method` is forced; the user's `when` choice is preserved.
    assert.deepEqual(doc.notifications, { method: "osc9", when: "unfocused" });
  });

  it("upgrades a bare bell to osc9", async () => {
    const dir = await tempDataDir("notifications:\n  method: bel\n");
    assert.equal(ensureMcodeNotificationPreference(options(dir)).changed, true);
    assert.deepEqual((await readConfig(dir)).notifications, { method: "osc9" });
  });

  it("is a no-op when already osc9", async () => {
    const dir = await tempDataDir("notifications:\n  method: osc9\n");
    const before = readFileSync(path.join(dir, "config.yaml"), "utf8");

    const result = ensureMcodeNotificationPreference(options(dir));

    assert.equal(result.changed, false);
    assert.equal(result.reason, "unchanged");
    assert.equal(readFileSync(path.join(dir, "config.yaml"), "utf8"), before);
  });

  it("respects a deliberate payload-carrying method", async () => {
    for (const method of ["osc777"]) {
      const dir = await tempDataDir(`notifications:\n  method: ${method}\n`);
      const before = readFileSync(path.join(dir, "config.yaml"), "utf8");

      const result = ensureMcodeNotificationPreference(options(dir));

      assert.equal(result.changed, false);
      assert.equal(result.reason, "user_choice");
      assert.equal(readFileSync(path.join(dir, "config.yaml"), "utf8"), before);
    }
  });

  it("never creates a config file for an unconfigured CLI", async () => {
    const dir = await tempDataDir();

    const result = ensureMcodeNotificationPreference(options(dir));

    assert.equal(result.changed, false);
    assert.equal(result.reason, "missing_config");
    assert.equal(existsSync(path.join(dir, "config.yaml")), false);
  });

  it("preserves comments and unknown keys while pinning the method", async () => {
    const dir = await tempDataDir(
      "# keep-me: user comment\ncustom_note: keep me\nlogLevel: info\nprovider:\n  minimax:\n    name: MiniMax\n"
    );

    ensureMcodeNotificationPreference(options(dir));

    const text = await readFile(path.join(dir, "config.yaml"), "utf8");
    assert.match(text, /# keep-me: user comment/);
    assert.match(text, /custom_note: keep me/);
    assert.match(text, /name: MiniMax/);
  });

  it("degrades quietly on a malformed config instead of failing the launch", async () => {
    const dir = await tempDataDir("notifications: [this, is, not, a, mapping]\n");
    const before = readFileSync(path.join(dir, "config.yaml"), "utf8");

    const result = ensureMcodeNotificationPreference(options(dir));

    assert.equal(result.changed, false);
    assert.equal(result.reason, "write_failed");
    assert.equal(readFileSync(path.join(dir, "config.yaml"), "utf8"), before);
  });
});

/**
 * The preference only matters if the payload survives the PTY. These lock the
 * end-to-end shape: the exact byte sequence the CLI emits must parse into a
 * text the ingestion layer can map, and a changed body must not be guessed at.
 */
describe("mcode OSC 9 payload", () => {
  it("parses the sequence the notifier emits for each event", () => {
    for (const body of [
      "Permission needs your input",
      "Response complete",
      "Response stopped with an error",
      "Question needs your input"
    ]) {
      const scanner = new TerminalNotificationScanner();
      const events = scanner.push(`\x1b]9;MCode: ${body}\x07`);
      assert.deepEqual(events, [{ kind: "osc", code: 9, text: `MCode: ${body}` }]);
    }
  });

  it("parses when the sequence is split across PTY chunks", () => {
    const scanner = new TerminalNotificationScanner();
    assert.deepEqual(scanner.push("noise\x1b]9;MCode: Permis"), []);
    assert.deepEqual(scanner.push("sion needs your input\x07"), [
      { kind: "osc", code: 9, text: "MCode: Permission needs your input" }
    ]);
  });
});

process.on("exit", () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try {
      // best effort; the temp root is disposable
      void rm(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
