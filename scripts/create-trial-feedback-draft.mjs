import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_WEB_URL = "http://127.0.0.1:48732";
const DEFAULT_GATEWAY_URL = "http://127.0.0.1:48731";
const DEFAULT_STARTUP_PATH = "npm/CLI / source fallback";
const MAX_DRAFT_LINE_LENGTH = 180;

export function buildTrialFeedbackDraft(input = {}) {
  const context = normalizeDraftContext(input);
  return `# OpenForge Trial Feedback Draft

Generated draft status: not submitted, not reviewed, not gate-clearing evidence.
Review and redact this draft before attaching diagnostics, screenshots, or written observations.

## Summary

- Result: pass / pass with caveats / blocked
- Affected surface: onboarding / dependency / provider / platform / terminal / Copilot / Feishu / Project Manager / docs / other
- Startup path: ${context.startupPath}
- OpenForge version or commit: ${context.commit}
- Operating system: ${context.os}
- Shell: ${context.shell}
- Windows native or WSL, if applicable:
- Browser and version:
- Web URL: ${context.webUrl}
- Gateway URL: ${context.gatewayUrl}

## Dependency Versions

- node --version: ${context.nodeVersion}
- tmux -V: ${context.tmuxVersion}
- claude --version: ${context.claudeVersion}
- opencode --version, if checked: ${context.opencodeVersion}
- codex --version, if checked: ${context.codexVersion}
- openforge doctor summary:

## Diagnostics Export

- Diagnostics export attached: yes / no
- Export path used: Settings -> Export diagnostics JSON / unavailable
- Do not ask first users to retrieve browser auth tokens from developer tools.
- Redaction review completed: no

## Reproduction Steps

1.
2.
3.

## Expected Behavior


## Actual Behavior


## Triage

- Category: dependency / provider / CLI / platform / Copilot / docs / E2E / other
- Severity: blocker / high / medium / low
- Mapped requirement: UX-01 / UX-02 / UX-03 / UX-04 / UX-05 / UX-06 / UX-07 / REL-*
- Owner:
- Disposition: gate-clearing evidence / preserved caveat / preserved blocker / product defect / docs or support gap / no action
- Follow-up route: issue #3 LIVE-PROVIDER / issue #4 WINDOWS-WSL / issue #5 FIRST-USER-FEEDBACK / Feishu callback evidence report / new issue / next phase / no action
- Next action or no-action rationale:
- Caveat status: none / pass with caveats / blocked

## Browser Evidence

- Console errors:
- Network failures:
- pnpm smoke:copilot-provider result: passed / skipped / failed
- Provider smoke skip or failure reason:
- Copilot provider with active model configured: yes / no / skipped
- Copilot prompt used:
- Copilot read-tool evidence observed:
- Copilot pending-action approve/reject result:
- Copilot memory write proposal tested: yes / no / skipped
- Confirmed no terminal/shell/Codex turn input in Copilot: yes / no
- Screenshots or written observations, redacted:
- Terminal attach result:
- Terminal input/output result summary, no raw transcript:
- Terminal resize result:
- Refresh/reconnect result:
- Stop-session result:
- Gateway/Web restart recovery result:
- Physical Windows/WSL result, if applicable:

## External Gate Notes

- \`LIVE-PROVIDER\`: Caveat until disposable provider credential/model smoke evidence is linked.
- \`WINDOWS-WSL\`: Caveat until physical Windows/WSL terminal evidence is linked.
- \`FEISHU-CALLBACK\`: Blocked until public HTTPS Gateway routing and Feishu console URL verification are available.
- \`FIRST-USER-FEEDBACK\`: Caveat until this packet is completed, redacted, and linked.

## Bounded Support Notes

- Gateway log summary, no raw log attachment:
- Web log summary, no raw log attachment:
- Relevant command result summary, no raw private output:
`;
}

export function collectTrialFeedbackDraftContext(options = {}) {
  const commandRunner = options.commandRunner ?? runCommand;
  return {
    commit: commandFirstLine(commandRunner, "git", ["rev-parse", "--short", "HEAD"], "unknown"),
    os: sanitizeDraftText(
      `${options.platform ?? os.platform()} ${options.arch ?? os.arch()} ${options.release ?? os.release()}`,
      { fallback: "unknown" }
    ),
    shell: sanitizeDraftText(options.env?.SHELL ?? process.env.SHELL ?? "unknown", { fallback: "unknown" }),
    nodeVersion: sanitizeDraftText(options.nodeVersion ?? process.version, { fallback: "unknown" }),
    tmuxVersion: commandFirstLine(commandRunner, "tmux", ["-V"], "unavailable"),
    claudeVersion: commandFirstLine(commandRunner, "claude", ["--version"], "unavailable"),
    opencodeVersion: commandFirstLine(commandRunner, "opencode", ["--version"], "unavailable"),
    codexVersion: commandFirstLine(commandRunner, "codex", ["--version"], "unavailable")
  };
}

export function parseDraftCliArgs(args) {
  const parsed = {
    outputPath: undefined,
    startupPath: DEFAULT_STARTUP_PATH,
    webUrl: DEFAULT_WEB_URL,
    gatewayUrl: DEFAULT_GATEWAY_URL
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--":
        break;
      case "--output":
        parsed.outputPath = requireValue(args, index, arg);
        index += 1;
        break;
      case "--startup-path":
        parsed.startupPath = requireValue(args, index, arg);
        index += 1;
        break;
      case "--web-url":
        parsed.webUrl = requireValue(args, index, arg);
        index += 1;
        break;
      case "--gateway-url":
        parsed.gatewayUrl = requireValue(args, index, arg);
        index += 1;
        break;
      case "--help":
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

export function sanitizeDraftText(value, options = {}) {
  const fallback = options.fallback ?? "";
  const firstLine = String(value ?? "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return fallback;
  }

  return redactSecrets(firstLine).slice(0, MAX_DRAFT_LINE_LENGTH);
}

function normalizeDraftContext(input) {
  return {
    commit: sanitizeDraftText(input.commit, { fallback: "unknown" }),
    os: sanitizeDraftText(input.os, { fallback: "unknown" }),
    shell: sanitizeDraftText(input.shell, { fallback: "unknown" }),
    nodeVersion: sanitizeDraftText(input.nodeVersion, { fallback: "unknown" }),
    tmuxVersion: sanitizeDraftText(input.tmuxVersion, { fallback: "unavailable" }),
    claudeVersion: sanitizeDraftText(input.claudeVersion, { fallback: "unavailable" }),
    opencodeVersion: sanitizeDraftText(input.opencodeVersion, { fallback: "unavailable" }),
    codexVersion: sanitizeDraftText(input.codexVersion, { fallback: "unavailable" }),
    startupPath: sanitizeDraftText(input.startupPath ?? DEFAULT_STARTUP_PATH, { fallback: DEFAULT_STARTUP_PATH }),
    webUrl: sanitizeDraftText(input.webUrl ?? DEFAULT_WEB_URL, { fallback: DEFAULT_WEB_URL }),
    gatewayUrl: sanitizeDraftText(input.gatewayUrl ?? DEFAULT_GATEWAY_URL, { fallback: DEFAULT_GATEWAY_URL })
  };
}

function commandFirstLine(commandRunner, command, args, fallback) {
  const result = commandRunner(command, args);
  if (!result || result.status !== 0) {
    return fallback;
  }
  return sanitizeDraftText(result.stdout || result.stderr, { fallback });
}

function runCommand(command, args) {
  try {
    return spawnSync(command, args, {
      cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
      encoding: "utf8",
      timeout: 3000,
      windowsHide: true
    });
  } catch (error) {
    return { status: 127, stderr: error instanceof Error ? error.message : "command failed" };
  }
}

function redactSecrets(value) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\bopenforge\.token\s*=\s*\S+/gi, "openforge.token=[redacted]")
    .replace(/\b(OPENFORGE_(?:MASTER_KEY|JWT_SECRET|ATTACH_TOKEN|API_KEY|TOKEN))\s*=\s*\S+/g, "$1=[redacted]")
    .replace(/\b(api[_-]?key|jwt|token|password|private[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}

function requireValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: node scripts/create-trial-feedback-draft.mjs [options]

Options:
  --output <path>        Write the draft to a file instead of stdout.
  --startup-path <text>  Startup path to prefill. Default: ${DEFAULT_STARTUP_PATH}
  --web-url <url>        Web URL to prefill. Default: ${DEFAULT_WEB_URL}
  --gateway-url <url>    Gateway URL to prefill. Default: ${DEFAULT_GATEWAY_URL}
`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseDraftCliArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
    } else {
      const context = {
        ...collectTrialFeedbackDraftContext(),
        startupPath: args.startupPath,
        webUrl: args.webUrl,
        gatewayUrl: args.gatewayUrl
      };
      const draft = buildTrialFeedbackDraft(context);
      if (args.outputPath) {
        fs.writeFileSync(args.outputPath, draft, "utf8");
      } else {
        process.stdout.write(draft);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
