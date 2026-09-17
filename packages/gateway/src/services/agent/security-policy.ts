/**
 * Copilot security policy engine — Codex-style "auto" security model.
 *
 * The policy evaluates every tool call before it executes. It returns one of:
 *   - auto_approve: low-risk call, execute immediately
 *   - require_approval: escalate to a pending action for owner decision
 *   - deny: reject with an error result (model can recover)
 *
 * The default rules are intentionally conservative. Read tools are unaffected.
 * Operate tools default to require_approval unless a rule explicitly auto-approves
 * a constrained input (e.g. create_project under the user's home directory).
 */
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, parse, resolve, sep } from "node:path";
import { DENIED_ROOTS } from "../../lib/safe-resolve.js";
import type { Database } from "../../db/types.js";

export type SecurityDecisionAction = "auto_approve" | "require_approval" | "deny";
export type RiskClass = "low" | "medium" | "high";

export interface SecurityDecision {
  action: SecurityDecisionAction;
  reason: string;
  riskClass: RiskClass;
}

export interface SecurityPolicyInput {
  userId: string;
  toolName: string;
  /** Tool risk tier declared at registration. */
  toolRisk: "read" | "operate";
  /** Tool owner's declared approval requirement. */
  requiresApproval: boolean;
  /** Parsed and validated tool input. */
  input: unknown;
}

export interface SecurityPolicyContext {
  homeDir?: string;
}

export function createSecurityPolicy(context?: SecurityPolicyContext) {
  const home = context?.homeDir ?? homedir();

  function evaluate(input: SecurityPolicyInput): SecurityDecision {
    // Global denylist first: traversal or known-dangerous patterns in any input.
    const dangerous = detectDangerousInput(input.input);
    if (dangerous) {
      return { action: "deny", reason: dangerous, riskClass: "high" };
    }

    // Read tools execute freely once dangerous patterns are ruled out.
    if (input.toolRisk === "read") {
      return { action: "auto_approve", reason: "read tool", riskClass: "low" };
    }

    // Tool explicitly marked as not requiring approval is still subject to denylist checks.
    const base = input.requiresApproval ? "require_approval" : "auto_approve";

    // Tool-specific rules.
    if (input.toolName === "create_project") {
      const decision = evaluateCreateProject(input.input, home);
      if (decision) return decision;
    }

    if (input.toolName === "advance_work_item") {
      return {
        action: "require_approval",
        reason: "state mutation requires owner confirmation",
        riskClass: "high"
      };
    }

    return {
      action: base as SecurityDecisionAction,
      reason: base === "auto_approve" ? "tool does not require approval" : "operate tool default approval gate",
      riskClass: input.requiresApproval ? "medium" : "low"
    };
  }

  return { evaluate };
}

function evaluateCreateProject(input: unknown, home: string): SecurityDecision | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const rawPath = (input as Record<string, unknown>).path;
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    return { action: "require_approval", reason: "missing project path", riskClass: "medium" };
  }

  if (containsTraversal(rawPath)) {
    return { action: "deny", reason: "path contains traversal segment", riskClass: "high" };
  }

  const expanded = expandHome(rawPath, home);
  if (!isAbsolute(expanded)) {
    return { action: "require_approval", reason: "relative project path; scope cannot be verified", riskClass: "medium" };
  }

  const normalized = resolve(expanded).toLowerCase();

  if (isUnderDeniedRoot(normalized)) {
    return { action: "deny", reason: "project path is under a denied system root", riskClass: "high" };
  }

  const homeLower = resolve(home).toLowerCase();
  const homeWithSep = homeLower.endsWith(sep) ? homeLower : homeLower + sep;
  if (!normalized.startsWith(homeWithSep) && normalized !== homeLower) {
    return { action: "require_approval", reason: "project path outside home directory", riskClass: "high" };
  }

  return { action: "auto_approve", reason: "project path is within home directory", riskClass: "low" };
}

function detectDangerousInput(input: unknown): string | undefined {
  const pending: unknown[] = [input];
  const visited = new Set<object>();

  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      const dangerous = detectDangerousText(value);
      if (dangerous) return dangerous;
      continue;
    }
    if (typeof value !== "object" || value === null || visited.has(value)) continue;
    visited.add(value);
    for (const [key, child] of Object.entries(value)) {
      const dangerousKey = detectDangerousText(key);
      if (dangerousKey) return dangerousKey;
      pending.push(child);
    }
  }

  return undefined;
}

function detectDangerousText(text: string): string | undefined {
  if (text.includes("../") || text.includes("..\\")) {
    return "input contains path traversal";
  }
  if (containsDangerousShellCommand(text)) {
    return "input contains potentially destructive shell pattern";
  }
  return undefined;
}

interface ShellSegment {
  text: string;
  boundary: "line" | "operator";
}

type ShellScanContext = "message" | "script";

function containsDangerousShellCommand(text: string, depth = 0, context: ShellScanContext = "message"): boolean {
  if (depth >= 4) return false;
  return collectShellSegments(text, context).some((segment) => isDangerousShellSegment(segment, depth));
}

function collectShellSegments(text: string, context: ShellScanContext): ShellSegment[] {
  const segments: ShellSegment[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  if (context === "script") return lines.flatMap((line) => splitShellLine(line));
  const tableLines = findMarkdownTableLines(lines);
  let fence: { char: string; length: number } | undefined;
  for (const [lineIndex, line] of lines.entries()) {
    const marker = /^(`{3,}|~{3,})/.exec(line.trimStart())?.[1];
    if (marker) {
      if (!fence) fence = { char: marker[0]!, length: marker.length };
      else if (marker[0] === fence.char && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence || tableLines.has(lineIndex) || isMarkdownCodeLine(line)) continue;
    segments.push(...splitShellLine(line));
  }
  return segments;
}

function findMarkdownTableLines(lines: string[]): Set<number> {
  const tableLines = new Set<number>();
  for (let index = 1; index < lines.length; index += 1) {
    if (!lines[index - 1]?.includes("|") || !isMarkdownTableDelimiter(lines[index] ?? "")) continue;
    tableLines.add(index - 1);
    tableLines.add(index);
    for (let row = index + 1; row < lines.length && lines[row]?.includes("|"); row += 1) {
      tableLines.add(row);
    }
  }
  return tableLines;
}

function isMarkdownTableDelimiter(line: string): boolean {
  const normalized = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = normalized.split("|").map((cell) => cell.trim());
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isMarkdownCodeLine(line: string): boolean {
  if (/^(?:\t| {4})/.test(line)) return true;
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|");
}

function splitShellLine(line: string): ShellSegment[] {
  const segments: ShellSegment[] = [];
  let start = 0;
  let boundary: ShellSegment["boundary"] = "line";
  let quote: "'" | '"' | "`" | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === "\\") { index += 1; continue; }
    if (quote) { if (char === quote) quote = undefined; continue; }
    if (char === "'" || char === '"' || char === "`") { quote = char; continue; }
    const width = shellSeparatorWidth(line, index);
    if (width === 0) continue;
    segments.push({ text: line.slice(start, index), boundary });
    start = index + width;
    boundary = "operator";
    index += width - 1;
  }
  segments.push({ text: line.slice(start), boundary });
  return segments;
}

function shellSeparatorWidth(line: string, index: number): number {
  if (line.startsWith("&&", index) || line.startsWith("||", index)) return 2;
  return line[index] === ";" || line[index] === "|" || line[index] === "&" ? 1 : 0;
}

function isDangerousShellSegment(segment: ShellSegment, depth: number): boolean {
  const raw = segment.text.trimStart();
  if (isStrictBareTruncation(raw, segment.boundary)) return true;
  const tokens = tokenizeShellWords(raw);
  if (!tokens) return false;
  const parsed = unwrapShellCommand(tokens);
  if (!parsed) return false;
  const { command, args } = parsed;
  if (command === "rm") return hasRecursiveForceFlags(args);
  if (command === "dd") return args.some((token) => /^(?:if|of)=.+/.test(token));
  if (command === "mkfs" || command?.startsWith("mkfs.")) return true;
  if (command.startsWith(":>")) return command.length > 2 || args.length > 0;
  if (command === ":") return isTruncatingRedirection(args);
  if (SHELL_COMMAND_WRAPPERS.has(command)) {
    const script = shellCommandScript(args);
    return script !== undefined && containsDangerousShellCommand(script, depth + 1, "script");
  }
  return false;
}

function shellCommandName(token: string | undefined): string | undefined {
  if (!token) return undefined;
  if (token.startsWith(":>")) return token;
  return token.split("/").at(-1);
}

function unwrapShellCommand(tokens: string[]): { command: string; args: string[] } | undefined {
  let working = tokens;
  let index = 0;
  for (let depth = 0; depth < 4; depth += 1) {
    while (isShellAssignment(working[index])) index += 1;
    const command = shellCommandName(working[index]);
    if (!command) return undefined;
    if (command === "sudo") { index = skipSudoOptions(working, index + 1); continue; }
    if (command === "env") {
      const expanded = expandEnvPrefix(working, index + 1);
      if (!expanded) return undefined;
      working = expanded.tokens;
      index = expanded.commandIndex;
      continue;
    }
    if (command === "command") {
      const next = skipCommandOptions(working, index + 1);
      if (next === undefined) return undefined;
      index = next;
      continue;
    }
    if (command === "nohup") {
      index += working[index + 1] === "--" ? 2 : 1;
      continue;
    }
    return { command, args: working.slice(index + 1) };
  }
  return undefined;
}

function isShellAssignment(token: string | undefined): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(token ?? "");
}

function skipCommandOptions(tokens: string[], start: number): number | undefined {
  let index = start;
  if (tokens[index] === "--") return index + 1;
  while (tokens[index] === "-p") index += 1;
  if (tokens[index] === "--") return index + 1;
  return tokens[index]?.startsWith("-") ? undefined : index;
}

const SHELL_COMMAND_WRAPPERS = new Set(["sh", "bash", "zsh"]);
const MAX_SHELL_WRAPPER_OPTIONS = 32;

function shellCommandScript(args: string[]): string | undefined {
  let index = 0;
  for (let optionCount = 0; index < args.length && optionCount < MAX_SHELL_WRAPPER_OPTIONS; optionCount += 1) {
    const option = readShellWrapperOption(args, index);
    if (!option) return undefined;
    index += option.consumed;
    if (option.hasCommand) return args[index];
  }
  return undefined;
}

interface ShellWrapperOption {
  consumed: 1 | 2;
  hasCommand: boolean;
}

function readShellWrapperOption(args: string[], index: number): ShellWrapperOption | undefined {
  const token = args[index];
  if (!token || token === "--") return undefined;
  if (token.startsWith("+")) return readShortShellWrapperOption(token, args[index + 1] !== undefined);
  if (!token.startsWith("-")) return undefined;
  if (SHELL_LONG_OPTIONS_WITH_VALUE.has(token)) {
    return args[index + 1] === undefined ? undefined : { consumed: 2, hasCommand: false };
  }
  if ([...SHELL_LONG_OPTIONS_WITH_VALUE].some((option) => token.startsWith(`${option}=`) && token.length > option.length + 1)) {
    return { consumed: 1, hasCommand: false };
  }
  if (token.startsWith("--")) {
    return SHELL_LONG_OPTIONS_WITHOUT_VALUE.has(token) ? { consumed: 1, hasCommand: false } : undefined;
  }
  return readShortShellWrapperOption(token, args[index + 1] !== undefined);
}

function readShortShellWrapperOption(token: string, hasNextToken: boolean): ShellWrapperOption | undefined {
  const flags = token.slice(1);
  if (!flags) return undefined;
  let hasCommand = false;
  let hasValueOption = false;
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index]!;
    if (flag === "c") { hasCommand = true; continue; }
    if (flag === "o" || flag === "O") {
      if (hasValueOption) return undefined;
      hasValueOption = true;
      const remainder = flags.slice(index + 1);
      if (remainder.startsWith("=")) {
        return remainder.length > 1 ? { consumed: 1, hasCommand } : undefined;
      }
      if (remainder && !isShellShortFlagSequence(remainder)) {
        return { consumed: 1, hasCommand };
      }
      continue;
    }
    if (!SHELL_SHORT_OPTIONS_WITHOUT_VALUE.has(flag)) return undefined;
  }
  if (hasValueOption && !hasNextToken) return undefined;
  return { consumed: hasValueOption ? 2 : 1, hasCommand };
}

function isShellShortFlagSequence(value: string): boolean {
  return [...value].every((flag) => flag === "c" || flag === "o" || flag === "O" || SHELL_SHORT_OPTIONS_WITHOUT_VALUE.has(flag));
}

const SHELL_SHORT_OPTIONS_WITHOUT_VALUE = new Set([
  "a", "b", "e", "f", "h", "i", "k", "l", "m", "n", "p", "r", "s", "t", "u", "v", "x",
  "B", "C", "D", "H", "L", "P"
]);
const SHELL_LONG_OPTIONS_WITH_VALUE = new Set(["--rcfile", "--init-file"]);
const SHELL_LONG_OPTIONS_WITHOUT_VALUE = new Set([
  "--debug", "--debugger", "--login", "--noediting", "--noprofile", "--norc", "--posix",
  "--protected", "--restricted", "--verbose", "--wordexp"
]);

function skipSudoOptions(tokens: string[], start: number): number {
  let index = start;
  while (tokens[index]?.startsWith("-")) {
    if (tokens[index] === "--") return index + 1;
    index += SUDO_OPTIONS_WITH_VALUE.has(tokens[index]!) ? 2 : 1;
  }
  return index;
}

const SUDO_OPTIONS_WITH_VALUE = new Set([
  "-u", "--user", "-g", "--group", "-h", "--host", "-p", "--prompt",
  "-C", "--close-from", "-R", "--chroot", "-D", "--chdir", "-T", "--command-timeout"
]);

function expandEnvPrefix(tokens: string[], start: number): { tokens: string[]; commandIndex: number } | undefined {
  const expanded = [...tokens];
  let index = start;
  let splitCount = 0;
  while (expanded[index]?.startsWith("-")) {
    const token = expanded[index]!;
    if (token === "--") { index += 1; break; }
    const split = readEnvSplitString(expanded, index);
    if (split) {
      if (splitCount >= 4) return undefined;
      const words = tokenizeEnvSplitString(split.value);
      if (!words) return undefined;
      expanded.splice(index, split.consumed, ...words);
      splitCount += 1;
      continue;
    }
    index += ENV_OPTIONS_WITH_VALUE.has(token) ? 2 : 1;
  }
  while (isShellAssignment(expanded[index])) index += 1;
  return { tokens: expanded, commandIndex: index };
}

const ENV_OPTIONS_WITH_VALUE = new Set([
  "-u", "--unset", "-C", "--chdir"
]);

function readEnvSplitString(tokens: string[], index: number): { value: string; consumed: number } | undefined {
  const token = tokens[index];
  if (token === "-S" || token === "--split-string") {
    return tokens[index + 1] === undefined ? undefined : { value: tokens[index + 1]!, consumed: 2 };
  }
  const prefix = "--split-string=";
  return token?.startsWith(prefix) ? { value: token.slice(prefix.length), consumed: 1 } : undefined;
}

function tokenizeEnvSplitString(input: string): string[] | undefined {
  if (input.length > 2_048) return undefined;
  let normalized = "";
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] === "\\" && input[index + 1] === "_") {
      normalized += " ";
      index += 1;
    } else {
      normalized += input[index];
    }
  }
  return tokenizeShellWords(normalized, 2_048, 64);
}

function tokenizeShellWords(input: string, maxLength = 8_192, maxWords = 128): string[] | undefined {
  if (input.length > maxLength) return undefined;
  const words: string[] = [];
  let current = "";
  let started = false;
  let quote: "'" | '"' | "`" | undefined;
  const push = () => {
    if (!started) return;
    words.push(current);
    current = "";
    started = false;
  };
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (char === "\\" && quote !== "'") {
      started = true;
      const next = input[index + 1];
      if (quote === '"' && next !== undefined && !DOUBLE_QUOTE_ESCAPES.has(next)) {
        current += "\\";
        continue;
      }
      if (next !== undefined) { current += next; index += 1; }
      continue;
    }
    if (quote) { if (char === quote) quote = undefined; else current += char; continue; }
    if (char === "'" || char === '"' || char === "`") { quote = char; started = true; continue; }
    if (char === " " || char === "\t") { push(); if (words.length > maxWords) return undefined; continue; }
    current += char;
    started = true;
  }
  if (quote) return undefined;
  push();
  return words.length > maxWords ? undefined : words;
}

const DOUBLE_QUOTE_ESCAPES = new Set(["$", "`", '"', "\\", "\n"]);

function hasRecursiveForceFlags(tokens: string[]): boolean {
  let recursive = false;
  let force = false;
  for (const token of tokens) {
    if (token === "--") break;
    if (token === "--recursive") recursive = true;
    if (token === "--force") force = true;
    if (/^-[^-]/.test(token)) {
      recursive ||= token.includes("r") || token.includes("R");
      force ||= token.includes("f");
    }
  }
  return recursive && force;
}

function isTruncatingRedirection(tokens: string[]): boolean {
  if (tokens[0] === ">") return tokens.length > 1;
  return tokens[0]?.startsWith(">") === true && !tokens[0].startsWith(">>") && tokens[0].length > 1;
}

function isStrictBareTruncation(raw: string, boundary: ShellSegment["boundary"]): boolean {
  if (!raw.startsWith(">") || raw.startsWith(">>")) return false;
  if (raw.length < 2) return false;
  if (raw[1] !== " " && raw[1] !== "\t") return true;
  return boundary === "operator" && /^>[ \t]+\S/.test(raw);
}

function expandHome(value: string, home: string): string {
  if (value === "~") return home;
  if (value.startsWith("~/")) return `${home}${value.slice(1)}`;
  if (value.startsWith("~\\")) return `${home}${value.slice(1)}`;
  return value;
}

function containsTraversal(value: string): boolean {
  const parts = value.split(/[\\/]+/);
  return parts.some((part) => part === "..");
}

function isUnderDeniedRoot(normalizedPath: string): boolean {
  if (process.platform === "win32") {
    // Deny drive roots (C:\, D:\) and system directories on Windows. Use the
    // running system's environment rather than hardcoding C: so machines where
    // Windows is installed on another drive are covered too.
    if (normalizedPath === parse(normalizedPath).root.toLowerCase()) return true;
    for (const systemRoot of [process.env.SystemRoot, process.env.ProgramFiles].filter(
      (value): value is string => Boolean(value)
    )) {
      const root = resolve(systemRoot).toLowerCase();
      if (normalizedPath === root || normalizedPath.startsWith(root + sep)) return true;
    }
  }
  for (const root of DENIED_ROOTS) {
    const r = root.toLowerCase();
    if (normalizedPath === r || normalizedPath.startsWith(`${r}/`) || normalizedPath.startsWith(`${r}\\`)) {
      return true;
    }
  }
  return false;
}

export interface OperationLogInput {
  db: Database;
  userId: string;
  operation: string;
  input: unknown;
  action: SecurityDecisionAction;
  reason: string;
}

/** Durable audit record of every policy decision. Idempotent by input digest. */
export function logSecurityDecision(input: OperationLogInput): void {
  const id = randomUUID();
  const idempotencyKey = createHash("sha256").update(JSON.stringify(input.input)).digest("hex");
  const payloadDigest = idempotencyKey;
  const resultJson = JSON.stringify({ action: input.action, reason: input.reason });
  try {
    input.db.prepare(`
    INSERT INTO copilot_operation_log (id, user_id, operation, idempotency_key, payload_digest, result_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.userId, input.operation, idempotencyKey, payloadDigest, resultJson, Date.now());
  } catch (err) {
    // A duplicate (user, operation, input-digest) audit record must not reject
    // the operation itself — the identical decision is already persisted.
    if (err instanceof Error && "code" in err && err.code === "SQLITE_CONSTRAINT_UNIQUE") return;
    throw err;
  }
}
