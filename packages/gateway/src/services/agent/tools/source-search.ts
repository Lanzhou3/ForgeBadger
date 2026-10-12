import { z } from 'zod';
import { ownedProject } from '../../development/commands.js';
import { listSourceFiles, readSource } from '../../development/workspace.js';
import { sourcePathSchema } from '../../development/contracts.js';
import { redactAgentText } from '../redaction.js';
import type { AgentTool } from '../tool-registry.js';

const inputSchema = z.object({ projectId: z.string().min(1).max(128), query: z.string().trim().min(1).max(200),
  path: sourcePathSchema.optional(), offset: z.number().int().min(0).max(20000).default(0),
  lineOffset: z.number().int().min(0).max(65536).default(0),
  limit: z.number().int().min(1).max(50).default(20) }).strict();

export function createSourceSearchTools(): AgentTool[] {
  return [{ name: 'search_project_files', description: 'Search source text by literal text (not regex). 搜索项目源代码中的文本，返回匹配文件和行号。 Returns paths, line numbers and redacted snippets. Bounded file scan; use nextOffset and nextLineOffset together to continue, or narrow path. Skips secret, hidden and symlink files.',
    risk: 'read', requiresApproval: false, inputSchema,
    async execute(raw, context) {
      const input = inputSchema.parse(raw);
      const root = ownedProject(context, input.projectId).path;
      const page = listSourceFiles(root, input.path, 100, input.offset);
      const matches: Array<{ path: string; line: number; text: string }> = [];
      let scanned = 0;
      let resume: { nextOffset: number; nextLineOffset: number } | undefined;
      for (const file of page.files) {
        if (matches.length >= input.limit) break;
        scanned++;
        try {
          const source = readSource(root, file); // Bounded 64 KiB per searched file.
          const lines = source.content.split('\n');
          for (let index = scanned === 1 ? input.lineOffset : 0; index < lines.length; index++) {
            if (lines[index]!.toLowerCase().includes(input.query.toLowerCase()))
              matches.push({ path: file, line: index + 1, text: redactAgentText(lines[index]!).slice(0, 500) });
            if (matches.length >= input.limit) {
              resume = { nextOffset: input.offset + scanned - 1, nextLineOffset: index + 1 };
              break;
            }
          }
        } catch { /* Unsupported or changed files are not evidence of a complete search. */ }
      }
      return { matches, scannedFiles: scanned, nextOffset: resume?.nextOffset ?? (scanned < page.files.length ? input.offset + scanned : page.nextOffset),
        nextLineOffset: resume?.nextLineOffset ?? 0,
        coverage: 'bounded_non_hidden_text_files_up_to_64KiB', scanLimitReached: page.scanLimitReached,
        truncated: matches.length >= input.limit || page.truncated };
    } }];
}
