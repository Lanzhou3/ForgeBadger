import { z } from 'zod';
import { listSourceFiles, readSource } from '../../development/workspace.js';
import { sourcePathSchema } from '../../development/contracts.js';
import { redactAgentText } from '../redaction.js';
import { CopilotMachineRootRepository } from '../../../db/repositories/copilot-machine-root-repository.js';
import type { AgentTool } from '../tool-registry.js';

const id = z.string().min(1).max(128);
const readFileInput = z.object({
  root: id,
  /** Slash-relative file path within the root (non-hidden, no backslash/..). */
  path: sourcePathSchema,
}).strict();

const treeInput = z.object({
  root: id,
  /** Narrow to a subdirectory subtree (slash-relative). */
  path: sourcePathSchema.optional(),
  limit: z.number().int().min(1).max(1000).default(400),
  maxDepth: z.number().int().min(1).max(20).default(10),
}).strict();

const inputSchema = z.object({
  /** Registered local-root id (owner-granted). Resolved and scope-checked against the owner's roots. */
  root: id,
  query: z.string().trim().min(1).max(200),
  /** Narrow to a subdirectory; slash-relative, rejects backslash/hidden/.. (sourcePathSchema). */
  path: sourcePathSchema.optional(),
  /** Glob over the slash-normalized relative path; `**` crosses directories, `*`/`?` stay within a segment. */
  pathGlob: z.string().trim().min(1).max(256).optional(),
  /** File-name extensions to keep, e.g. ['ts','tsx']; matched case-insensitively. */
  extFilter: z.array(z.string().trim().min(1).max(32)).max(32).optional(),
  /** 'literal' is a case-insensitive substring (default); 'regex' compiles `query` case-insensitively. */
  mode: z.enum(['literal', 'regex']).default('literal'),
  offset: z.number().int().min(0).max(20000).default(0),
  lineOffset: z.number().int().min(0).max(65536).default(0),
  limit: z.number().int().min(1).max(50).default(20),
}).strict();

// Self-contained glob: the search space is already '/'-normalized relative paths
// (listSourceFiles joins with '/'; sourcePathSchema forbids backslash), so a
// backslash-free converter is unambiguous on Windows, macOS and Linux alike.
function globToRegExp(glob: string): RegExp {
  let out = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') { out += '.*'; i++; }
      else out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else if ('\\^$.|+()[]{}()'.includes(c)) {
      out += '\\' + c;
    } else {
      out += c;
    }
  }
  return new RegExp(out + '$');
}

/**
 * Read-only agent search over an owner-registered local root. This is the
 * machine-file half of "agent search": the orchestrator already drives the
 * search -> read -> re-search loop, so this tool only exposes a cross-platform
 * file finder that reuses the development workspace's guarded readers
 * (per-segment symlink lstat, O_NOFOLLOW, 64 KiB cap, secret/hidden skip).
 */
export function createMachineSearchTools(): AgentTool[] {
  return [{
    name: 'machine_search',
    description: 'Agent search over an owner-registered LOCAL root (files outside any registered project). Read-only. '
      + 'Search by literal text (default) or regex; narrow with a subdirectory `path`, a `pathGlob` over the relative path, or an `extFilter` of extensions. '
      + 'Returns matching paths, line numbers and redacted snippets with nextOffset/nextLineOffset pagination. Bounded scan: 64 KiB per file, 100 files per page. '
      + 'The `root` must be an id returned by register_machine_root.',
    risk: 'read',
    requiresApproval: false,
    inputSchema,
    async execute(raw, context) {
      const input = inputSchema.parse(raw);
      const rootEntry = new CopilotMachineRootRepository(context.db, context.userId).getById(input.root);
      if (!rootEntry)
        throw new Error('MACHINE_ROOT_NOT_FOUND: register this local path first with register_machine_root');
      const page = listSourceFiles(rootEntry.path, input.path, 100, input.offset);
      const nameFilter = input.extFilter ? new Set(input.extFilter.map((ext) => ext.replace(/^\./, '').toLowerCase())) : undefined;
      const glob = input.pathGlob ? globToRegExp(input.pathGlob) : undefined;
      const queryRe = input.mode === 'regex' ? new RegExp(input.query, 'i') : null;
      const queryLower = input.query.toLowerCase();
      const matches: Array<{ path: string; line: number; text: string }> = [];
      let scanned = 0;
      let resume: { nextOffset: number; nextLineOffset: number } | undefined;
      for (const file of page.files) {
        scanned++;
        if (nameFilter) {
          const dot = file.lastIndexOf('.');
          if (!nameFilter.has(dot >= 0 ? file.slice(dot + 1).toLowerCase() : ''))
            continue;
        }
        if (glob && !glob.test(file))
          continue;
        if (matches.length >= input.limit)
          break;
        try {
          const source = readSource(rootEntry.path, file);
          const lines = source.content.split('\n');
          for (let index = scanned === 1 ? input.lineOffset : 0; index < lines.length; index++) {
            const line = lines[index]!;
            if (queryRe ? queryRe.test(line) : line.toLowerCase().includes(queryLower)) {
              matches.push({ path: file, line: index + 1, text: redactAgentText(line).slice(0, 500) });
              if (matches.length >= input.limit) {
                resume = { nextOffset: input.offset + scanned - 1, nextLineOffset: index + 1 };
                break;
              }
            }
          }
        } catch { /* Unsupported or changed files are not evidence of a complete search. */ }
      }
      return {
        matches,
        scannedFiles: scanned,
        nextOffset: resume?.nextOffset ?? (scanned < page.files.length ? input.offset + scanned : page.nextOffset),
        nextLineOffset: resume?.nextLineOffset ?? 0,
        coverage: 'bounded_non_hidden_text_files_up_to_64KiB',
        scanLimitReached: page.scanLimitReached,
        truncated: matches.length >= input.limit || page.truncated,
      };
    },
  },
  {
    name: 'read_machine_file',
    description: 'Read one file (redacted, up to 64 KiB) from an owner-registered local root, to open the full context a machine_search snippet points at. The root must be a registered root id.',
    risk: 'read',
    requiresApproval: false,
    inputSchema: readFileInput,
    async execute(raw, context) {
      const input = readFileInput.parse(raw);
      const rootEntry = new CopilotMachineRootRepository(context.db, context.userId).getById(input.root);
      if (!rootEntry)
        throw new Error('MACHINE_ROOT_NOT_FOUND: register this local path first with register_machine_root');
      const source = readSource(rootEntry.path, input.path);
      return { path: source.path, content: redactAgentText(source.content), sha256: source.sha256, bytes: source.bytes };
    },
  },
  {
    name: 'machine_tree',
    description: 'Build a bounded file/directory map of an owner-registered local root (what\'s where), so you can survey the structure before machine_search. ' +
      'Returns the relative file paths (up to `limit`, depth <= `maxDepth`), per-directory file counts, and a truncated/scan-limit flag. Read-only.',
    risk: 'read',
    requiresApproval: false,
    inputSchema: treeInput,
    async execute(raw, context) {
      const input = treeInput.parse(raw);
      const rootEntry = new CopilotMachineRootRepository(context.db, context.userId).getById(input.root);
      if (!rootEntry)
        throw new Error('MACHINE_ROOT_NOT_FOUND: register this local path first with register_machine_root');
      const files: string[] = [];
      const directoryCounts = new Map<string, number>();
      let scanned = 0;
      let truncated = false;
      let scanLimitReached = false;
      let offset = 0;
      let exhausted = false;
      while (!exhausted && files.length < input.limit) {
        const page = listSourceFiles(rootEntry.path, input.path, 100, offset);
        if (page.files.length === 0) { exhausted = true; break; }
        for (const file of page.files) {
          scanned++;
          if (file.split('/').length - 1 > input.maxDepth) { truncated = true; continue; }
          files.push(file);
          const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.';
          directoryCounts.set(dir, (directoryCounts.get(dir) ?? 0) + 1);
          if (files.length >= input.limit) { truncated = true; break; }
        }
        scanLimitReached = scanLimitReached || page.scanLimitReached;
        exhausted = page.nextOffset === null;
        offset = page.nextOffset ?? offset + page.files.length;
      }
      const directories = [...directoryCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 100)
        .map(([dir, count]) => ({ directory: dir, files: count }));
      return { files, directories, count: files.length, truncated, scanLimitReached, maxDepth: input.maxDepth, coverage: 'bounded_file_tree_map' };
    },
  }];
}
