/**
 * Minimax Code terminal notification preference.
 *
 * MiniMax Code ships a notifier that emits OSC 9 / OSC 99 / OSC 777 / BEL and
 * picks the method from `notifications.method` in config.yaml
 * (`when` is `unfocused | always | never`; `method` is
 * `auto | osc9 | osc777 | bel`). Verified against @minimax-ai/code 0.5.8.
 *
 * Under ForgeBadger the `auto` resolution degrades to a bare BEL: the PTY
 * environment has no TERM_PROGRAM on the ghostty/iTerm/WezTerm/Warp list, no
 * KITTY_WINDOW_ID and no WT_SESSION, so the notifier takes the plain-bell
 * branch. A bell carries no payload, so the event kind and message are lost and
 * the session terminal could only report "something happened".
 *
 * Forcing `osc9` makes the payload survive:
 *
 * ```
 * ESC ] 9 ; MCode: Permission needs your input BEL
 * ```
 *
 * which `terminal-notification-scanner` already parses and
 * `terminal-notification-ingestion` maps to a concrete event type. This is the
 * same lever ForgeBadger already uses for Codex, which passes
 * `-c 'tui.notification_method="osc9"'` on the launch command line; MiniMax
 * Code has no equivalent flag, so the preference has to live in its config.
 *
 * Policy notes:
 * - Only `method` is touched. `when` stays the user's choice, because the CLI
 *   already defaults to firing only when the terminal is not focused, which is
 *   the behaviour a browser-hosted terminal wants.
 * - A user who explicitly selected a different method keeps it; the write is a
 *   no-op unless the value is absent, `auto`, or the equivalent `bel`. Forcing
 *   a deliberate `osc777`/`osc99` choice would be overriding the user.
 * - The file is only created when it already exists, so an adapter that has
 *   never been configured is never given a config file as a side effect.
 */

import { existsSync, readFileSync } from "node:fs";

import { loadYamlConfig, saveYamlConfig } from "./cli-config-yaml.js";
import { globalConfigRoot } from "./cli-config-target.js";
import { atomicWriteConfig } from "./cli-config-fs.js";
import type { CliAccountProbeOptions } from "./cli-account/claude-account.js";
import { probeConfigRootOptions } from "./cli-account/probe-runner.js";

/** Methods that carry no payload, or defer to a host-specific branch. */
const REPLACEABLE_METHODS = new Set(["auto", "bel"]);

const PREFERRED_METHOD = "osc9";

export interface EnsureMcodeNotificationPreferenceResult {
  /** True when config.yaml was rewritten. */
  changed: boolean;
  /** Absolute path written, when changed. */
  path?: string;
  reason?: "missing_config" | "unchanged" | "user_choice" | "write_failed";
}

/**
 * Ensure `<dataDir>/config.yaml` asks for OSC 9 notifications. Safe to call on
 * every session start: it reads and (only when needed) rewrites one small file.
 */
export function ensureMcodeNotificationPreference(
  options: CliAccountProbeOptions = {}
): EnsureMcodeNotificationPreferenceResult {
  const root = globalConfigRoot("mcode", probeConfigRootOptions(options));
  const target = `${root}/config.yaml`;
  if (!existsSync(target)) {
    // Never materialize a config file for a CLI the user has never set up.
    return { changed: false, reason: "missing_config" };
  }

  let serialized: string;
  try {
    const handle = loadYamlConfig(readConfigText(target));
    const current = handle.root.notifications;
    const method = isRecord(current) && typeof current.method === "string" ? current.method : undefined;

    if (method !== undefined && !REPLACEABLE_METHODS.has(method)) {
      // The user picked a payload-carrying method deliberately.
      return { changed: false, reason: "user_choice" };
    }
    if (method === PREFERRED_METHOD) {
      return { changed: false, reason: "unchanged" };
    }

    handle.doc.setIn(["notifications", "method"], PREFERRED_METHOD);
    serialized = saveYamlConfig(handle);
  } catch {
    return { changed: false, reason: "write_failed" };
  }

  try {
    atomicWriteConfig(target, serialized);
  } catch {
    return { changed: false, reason: "write_failed" };
  }
  return { changed: true, path: target };
}

function readConfigText(target: string): string {
  return readFileSync(target, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
