import { z } from 'zod';
import type { AgentTool } from '../tool-registry.js';
import { redactAgentValue } from '../redaction.js';
import { listSourceFiles, ownedProject, readSource, sourcePathSchema } from '../project-source.js';

const projectIdSchema = z.string().min(1).max(128);

export function createProjectFileTools(): AgentTool[] {
  return [
    {
      name: 'list_project_files',
      description: 'List bounded, non-hidden source paths in a project. Skips dependencies and secrets.',
      risk: 'read',
      requiresApproval: false,
      inputSchema: z.object({
        projectId: projectIdSchema,
        path: sourcePathSchema.optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).max(20000).optional()
      }).strict(),
      async execute(raw, ctx) {
        const v = raw as { projectId: string; path?: string; limit?: number; offset?: number };
        return listSourceFiles(ownedProject(ctx, v.projectId).path, v.path, v.limit, v.offset);
      }
    },
    {
      name: 'read_project_file',
      description: 'Read source text and SHA256 for a project file. No symlinks, hidden or credential files.',
      risk: 'read',
      requiresApproval: false,
      inputSchema: z.object({
        projectId: projectIdSchema,
        path: sourcePathSchema,
        offset: z.number().int().min(0).max(1048576).optional(),
        length: z.number().int().min(1).max(16000).optional()
      }).strict(),
      async execute(raw, ctx) {
        const v = raw as { projectId: string; path: string; offset?: number; length?: number };
        const source = readSource(ownedProject(ctx, v.projectId).path, v.path, 1048576);
        const view = redactAgentValue(source.content) as string;
        const offset = v.offset ?? 0;
        const end = Math.min(view.length, offset + (v.length ?? 12000));
        return {
          path: source.path,
          sha256: source.sha256,
          sha256Of: 'original_file',
          content: view.slice(offset, end),
          redacted: view !== source.content,
          offsetSpace: 'redacted_text',
          offset,
          nextOffset: end < view.length ? end : null,
          totalChars: view.length
        };
      }
    }
  ];
}
