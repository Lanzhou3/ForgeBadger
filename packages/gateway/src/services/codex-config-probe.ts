/**
 * Codex config validation probe.
 *
 * Newer Codex versions (0.157.x and later, per openai/codex discussion #7782)
 * removed the `chat` wire API and hard-fail at startup when ANY
 * `model_providers.*` entry uses `wire_api = "chat"` — including inactive
 * ones. Applying such a config through ForgeBadger's apply-provider flow used
 * to write `~/.codex/config.toml` and make every new Codex session exit
 * immediately (the TUI never renders).
 *
 * Instead of maintaining a version threshold, ask the installed Codex itself:
 * run `codex exec` against a throwaway CODEX_HOME that carries the planned
 * config with every provider endpoint pointed at a dead local URL (the
 * config-load phase is what we validate; no real gateway is ever called and
 * no credential leaves this module). If the planned content is rejected but
 * the same content with `wire_api = "responses"` is accepted, the plan is
 * unsafe for the installed Codex and the apply must fail with Codex's own
 * error text.
 *
 * The probe is advisory-by-construction in the other direction: any outcome
 * that is not a proven config rejection (missing CLI, timeout, auth/network
 * failures) is reported as "supported" so a misbehaving probe can never
 * block an apply that used to work.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import {
  checkCommand,
  runCommand,
  type CommandResult,
  type CommandRunner
} from "../lib/dependency-check.js";

export type CodexConfigProbeStatus = "skipped" | "supported" | "unsupported";

/** Probe function shape: receives the planned config.toml content. */
export type CodexConfigProbeFn = (
  plannedConfigToml: string
) => Promise<CodexConfigProbeOutcome>;

export interface CodexConfigProbeOutcome {
  status: CodexConfigProbeStatus;
  /** `codex --version` output (e.g. "codex-cli 0.157.1") when the probe ran. */
  codexVersion?: string | undefined;
  /** Codex's own error text when the planned config was rejected. */
  detail?: string | undefined;
}

export interface CodexConfigProbeInput {
  /** Planned content of the global Codex config.toml (secrets may be placeholders). */
  plannedConfigToml: string;
  runner?: CommandRunner | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

const VERSION_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 10_000;
const MAX_DETAIL_CHARS = 400;
/** Guaranteed-closed local port: after config load the probe's model call
 * fails instantly with ECONNREFUSED instead of reaching a real gateway. */
const DEAD_BASE_URL = "http://127.0.0.1:9/v1";

/** The 0.157.x removal error: `wire_api = "chat"` is no longer supported. */
const WIRE_API_CHAT_REMOVAL = /wire_api[\s\S]{0,200}?no longer supported/iu;
/** Generic config-load failure signatures (wording may drift between versions). */
const CONFIG_LOAD_FAILED = /error loading config|failed to (load|parse) (config|toml)|invalid (config|toml)/iu;

const execArgs = ["exec", "forgebadger-probe", "--ephemeral", "--skip-git-repo-check"];

export async function probeCodexPlannedConfig(
  input: CodexConfigProbeInput
): Promise<CodexConfigProbeOutcome> {
  const probeRunner: CommandRunner = input.runner ?? runCommand;
  const env = input.env ?? process.env;

  const versionCheck = await checkCommand("codex", ["--version"], probeRunner, {
    env,
    timeoutMs: VERSION_TIMEOUT_MS
  });
  if (!versionCheck.available) {
    // No Codex on this machine: nothing to validate against; keep the
    // historical behavior of writing the plan as-is.
    return { status: "skipped" };
  }
  const codexVersion = versionCheck.version;

  let home: string | undefined;
  try {
    home = await mkdtemp(path.join(tmpdir(), "forgebadger-codex-probe-"));
    const planned = neutralizeProviderNetworks(input.plannedConfigToml);
    if (planned === null) {
      // Unparseable plan: the real apply would fail its own parse; do not
      // mask that error with a probe verdict.
      return { status: "skipped", ...(codexVersion ? { codexVersion } : {}) };
    }

    const probeA = await runProbe(probeRunner, env, home, planned);
    const outputA = combinedOutput(probeA);
    if (WIRE_API_CHAT_REMOVAL.test(outputA)) {
      return unsupported(outputA, codexVersion);
    }
    if (CONFIG_LOAD_FAILED.test(outputA)) {
      // The plan was rejected at config load; prove the rejection is the wire
      // API value (and not, say, an unrelated user field) by re-running the
      // same plan with wire_api forced to "responses".
      const relaxed = forceResponsesWireApi(planned);
      if (relaxed !== null) {
        const probeB = await runProbe(probeRunner, env, home, relaxed);
        if (!CONFIG_LOAD_FAILED.test(combinedOutput(probeB))) {
          return unsupported(outputA, codexVersion);
        }
      }
    }
    return { status: "supported", ...(codexVersion ? { codexVersion } : {}) };
  } catch {
    // Probe infrastructure failure (temp dir, TOML round-trip, spawn error):
    // never block an apply because the probe itself misbehaved.
    return { status: "skipped", ...(codexVersion ? { codexVersion } : {}) };
  } finally {
    if (home) await rm(home, { recursive: true, force: true });
  }
}

async function runProbe(
  runner: CommandRunner,
  env: NodeJS.ProcessEnv,
  home: string,
  configToml: string
): Promise<CommandResult> {
  await writeFile(path.join(home, "config.toml"), configToml, { mode: 0o600 });
  return runner("codex", execArgs, {
    env: { ...env, CODEX_HOME: home },
    timeoutMs: PROBE_TIMEOUT_MS
  });
}

function neutralizeProviderNetworks(
  plannedConfigToml: string
): string | null {
  const doc = parseToml(plannedConfigToml);
  const providers = (doc as Record<string, unknown>).model_providers;
  if (providers && typeof providers === "object") {
    for (const entry of Object.values(providers as Record<string, unknown>)) {
      if (entry && typeof entry === "object") {
        (entry as Record<string, unknown>).base_url = DEAD_BASE_URL;
        delete (entry as Record<string, unknown>).experimental_bearer_token;
        delete (entry as Record<string, unknown>).env_key;
      }
    }
  }
  return stringifyToml(doc);
}

function forceResponsesWireApi(planned: string): string | null {
  const doc = parseToml(planned);
  const providers = (doc as Record<string, unknown>).model_providers;
  if (providers && typeof providers === "object") {
    for (const entry of Object.values(providers as Record<string, unknown>)) {
      if (entry && typeof entry === "object") {
        (entry as Record<string, unknown>).wire_api = "responses";
      }
    }
  }
  return stringifyToml(doc);
}

function combinedOutput(result: CommandResult): string {
  return stripTerminalCodes(`${result.stdout}\n${result.stderr}`);
}

function stripTerminalCodes(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/gu, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/gu, "")
    .replace(/\x1b[@-Z\\-_]/gu, "")
    .replace(/\r/gu, "");
}

function unsupported(output: string, codexVersion: string | undefined): CodexConfigProbeOutcome {
  return {
    status: "unsupported",
    ...(codexVersion ? { codexVersion } : {}),
    detail: excerpt(output)
  };
}

function excerpt(output: string): string {
  const lines = output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  return lines.join("\n").slice(0, MAX_DETAIL_CHARS);
}
