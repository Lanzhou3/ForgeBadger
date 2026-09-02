import { spawnSync } from "node:child_process";

export const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_NPM_INSTALL_TIMEOUT_MS = 20 * 60_000;
const DEFAULT_MAX_BUFFER = 50 * 1024 * 1024;

export function readPositiveIntegerEnv(env, key, fallback) {
  const raw = env[key];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function buildNpmInstallArgs(options) {
  return [
    "install",
    "--prefix",
    options.npmPrefix,
    "--cache",
    options.npmCache,
    "--ignore-scripts=false",
    "--omit=peer",
    "--legacy-peer-deps",
    "--fetch-retries=5",
    "--fetch-retry-factor=2",
    "--fetch-retry-mintimeout=2000",
    "--fetch-retry-maxtimeout=60000",
    "--fetch-timeout=120000",
    "--no-audit",
    "--no-fund",
    options.tarball
  ];
}

export function buildRegistrationPayload(email, password, recoveryKey) {
  return { email, password, recoveryKey };
}

export function runCommand(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const spawnSyncImpl = options.spawnSyncImpl ?? spawnSync;
  const result = spawnSyncImpl(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    shell: (options.platform ?? process.platform) === "win32",
    timeout: timeoutMs,
    maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER
  });

  if (result.status !== 0 || result.signal || result.error) {
    const message = formatCommandFailure(command, args, result, {
      label: options.label,
      timeoutMs
    });
    const stderrWriter = options.stderrWriter ?? ((text) => process.stderr.write(text));
    stderrWriter(`\n${message}\n`);
    throw new Error(message);
  }

  if (options.printOutput !== false && result.stdout) {
    const stdoutWriter = options.stdoutWriter ?? ((text) => process.stdout.write(text));
    stdoutWriter(result.stdout);
  }
  if (options.printOutput !== false && result.stderr) {
    const stderrWriter = options.stderrWriter ?? ((text) => process.stderr.write(text));
    stderrWriter(result.stderr);
  }

  return result;
}

export function resolveTerminalMultiplexerCommand(
  platform = process.platform
) {
  return platform === "win32" ? "psmux" : "tmux";
}

export function formatCommandFailure(command, args, result, options = {}) {
  const lines = [];
  if (options.label) {
    lines.push(`Step failed: ${options.label}`);
  }
  lines.push(`Command failed: ${formatCommand(command, args)}`);
  if (isTimeout(result)) {
    lines.push(`Command timed out after ${options.timeoutMs}ms`);
  }
  if (typeof result.status === "number") {
    lines.push(`Exit status: ${result.status}`);
  }
  if (result.signal) {
    lines.push(`Signal: ${result.signal}`);
  }
  if (result.error) {
    lines.push(`Error: ${result.error.message}`);
  }
  appendOutput(lines, "stdout", result.stdout);
  appendOutput(lines, "stderr", result.stderr);
  return lines.join("\n");
}

function isTimeout(result) {
  return result.error?.code === "ETIMEDOUT";
}

function appendOutput(lines, label, output) {
  if (!output) {
    return;
  }
  const text = String(output);
  lines.push(`\n${label}:\n${text.endsWith("\n") ? text.slice(0, -1) : text}`);
}

function formatCommand(command, args) {
  return [command, ...args].join(" ");
}
