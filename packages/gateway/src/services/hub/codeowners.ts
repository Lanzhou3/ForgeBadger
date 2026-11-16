import { lstatSync, readFileSync } from "node:fs";

import { safeResolve } from "../../lib/safe-resolve.js";

export interface CodeownersEntry {
  pattern: string;
  owners: string[];
}

export const CODEOWNERS_CANDIDATES: readonly string[] = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];
export const CODEOWNERS_MAX_BYTES = 256 * 1024;
const MAX_ENTRIES = 500;
const MAX_PATTERN_LENGTH = 300;

/** Parses CODEOWNERS text. Comments, blanks and over-long patterns are skipped. */
export function parseCodeowners(text: string): CodeownersEntry[] {
  const entries: CodeownersEntry[] = [];
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.replace(/(^|\s)#.*$/u, "").trim();
    if (!line) continue;
    const [pattern, ...owners] = line.split(/\s+/u);
    if (!pattern || pattern.length > MAX_PATTERN_LENGTH || !compile(pattern)) continue;
    entries.push({ pattern, owners });
    if (entries.length >= MAX_ENTRIES) break;
  }
  return entries;
}

const MAX_WILDCARDS = 16;
const MAX_SEGMENTS = 32;
const MAX_PATH_SEGMENTS = 256;

interface CompiledPattern {
  segments: string[];
  directoryOnly: boolean;
}

function compile(pattern: string): CompiledPattern | null {
  const directoryOnly = pattern.endsWith("/");
  const body = pattern.replace(/^\/+|\/+$/gu, "");
  const anchored = pattern.replace(/\/+$/u, "").includes("/");
  const wildcards = [...pattern].filter(char => char === "*" || char === "?").length;
  const parts = body.split("/").filter(Boolean);
  if (parts.length === 0 || parts.length > MAX_SEGMENTS || wildcards > MAX_WILDCARDS) return null;
  const segments: string[] = [];
  // A pattern without a slash may match at any depth.
  for (const part of anchored ? parts : ["**", ...parts]) {
    if (part === "**" && segments[segments.length - 1] === "**") continue;
    segments.push(part);
  }
  return { segments, directoryOnly };
}

/**
 * Glob match of one path segment (`*` any run, `?` one character) with the
 * classic two-pointer walk that remembers only the last `*`; no regex is built
 * from pattern text and the cost is bounded by pattern length times segment length.
 */
function globMatch(glob: string, text: string): boolean {
  let g = 0;
  let t = 0;
  let star = -1;
  let resume = 0;
  while (t < text.length) {
    if (g < glob.length && (glob[g] === "?" || glob[g] === text[t])) {
      g += 1;
      t += 1;
    } else if (g < glob.length && glob[g] === "*") {
      star = g;
      resume = t;
      g += 1;
    } else if (star >= 0) {
      g = star + 1;
      resume += 1;
      t = resume;
    } else {
      return false;
    }
  }
  while (glob[g] === "*") g += 1;
  return g === glob.length;
}

/**
 * reach[i][j] is true when the first i pattern segments can consume exactly the
 * first j path segments. A `**` segment spans zero or more segments, or one or
 * more when it is last. Cost is O(patternSegments x pathSegments).
 */
function reachable(segments: string[], path: string[]): boolean[][] {
  const reach = segments.map(() => new Array<boolean>(path.length + 1).fill(false));
  reach.push(new Array<boolean>(path.length + 1).fill(false));
  reach[0]![0] = true;
  segments.forEach((segment, i) => {
    const from = reach[i]!;
    const to = reach[i + 1]!;
    const last = i === segments.length - 1;
    for (let j = 0; j <= path.length; j += 1) {
      if (segment === "**") {
        to[j] = (!last && from[j]!) || (j > 0 && (to[j - 1]! || from[j - 1]!));
      } else {
        to[j] = j > 0 && from[j - 1]! && globMatch(segment, path[j - 1]!);
      }
    }
  });
  return reach;
}

/** True when the pattern selects the file itself or any directory above it. */
export function matchesPattern(pattern: string, filePath: string): boolean {
  if (!pattern || pattern.length > MAX_PATTERN_LENGTH) return false;
  const compiled = compile(pattern);
  const path = filePath.replace(/^\/+/u, "").split("/").filter(Boolean);
  if (!compiled || path.length === 0 || path.length > MAX_PATH_SEGMENTS) return false;
  const finish = reachable(compiled.segments, path)[compiled.segments.length]!;
  const longest = compiled.directoryOnly ? path.length - 1 : path.length;
  for (let length = 1; length <= longest; length += 1) if (finish[length]) return true;
  return false;
}

/** The last matching entry wins, as in Git hosting CODEOWNERS semantics. */
export function ownersFor(entries: CodeownersEntry[], filePath: string): CodeownersEntry | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (matchesPattern(entries[index]!.pattern, filePath)) return entries[index]!;
  }
  return null;
}

/**
 * Reads the first existing CODEOWNERS from the mirror working tree. Symlinks,
 * non-regular files and oversized files are refused as if absent.
 */
export function readCodeowners(mirrorPath: string): CodeownersEntry[] {
  for (const candidate of CODEOWNERS_CANDIDATES) {
    let resolved: string;
    try {
      resolved = safeResolve(mirrorPath, candidate);
    } catch {
      return [];
    }
    let stat;
    try {
      stat = lstatSync(resolved);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > CODEOWNERS_MAX_BYTES) return [];
    try {
      return parseCodeowners(readFileSync(resolved, "utf8"));
    } catch {
      return [];
    }
  }
  return [];
}
