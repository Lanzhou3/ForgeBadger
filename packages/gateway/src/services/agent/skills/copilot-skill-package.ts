import { parseDocument, stringify } from 'yaml';
import { z } from 'zod';
import type { CopilotSkillFile, CopilotSkillSnapshot, CopilotSkillSource } from '../../../db/repositories/copilot-skill-revision-repository.js';

export const MAX_COPILOT_SKILL_FILES = 65;
export const MAX_COPILOT_SKILL_FILE_BYTES = 128 * 1024;
export const MAX_COPILOT_SKILL_PACKAGE_BYTES = 1024 * 1024;
const fileSchema = z.object({ path: z.string().min(1).max(512), content: z.string() }).strict();
export const skillFilesSchema = z.array(fileSchema).min(1).max(MAX_COPILOT_SKILL_FILES);
const metadataSchema = z.object({ name: z.string().min(1).max(128).regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/u),
  description: z.string().min(1).max(2048), version: z.union([z.string().min(1).max(128), z.number().finite()]).optional() }).passthrough();

export function validateSkillPackageFiles(input: unknown): CopilotSkillFile[] {
  const files = skillFilesSchema.parse(input);
  const paths = new Set<string>(); let total = 0;
  for (const file of files) {
    validateSkillFilePath(file.path);
    const normalized = file.path.toLowerCase();
    if (paths.has(normalized)) throw new Error('Duplicate Skill file path');
    paths.add(normalized);
    const bytes = Buffer.byteLength(file.content, 'utf8'); total += bytes;
    if (bytes > MAX_COPILOT_SKILL_FILE_BYTES || total > MAX_COPILOT_SKILL_PACKAGE_BYTES) throw new Error('Skill package exceeds UTF-8 file or total size limit');
    if (file.content.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(file.content)) throw new Error('Skill files must be valid UTF-8 text without binary content');
  }
  for (const file of files) {
    const segments = file.path.toLowerCase().split('/'); segments.pop();
    while (segments.length) { if (paths.has(segments.join('/'))) throw new Error('Skill file/directory path collision'); segments.pop(); }
  }
  if (!files.some(file => file.path === 'SKILL.md')) throw new Error('Skill package requires exact root SKILL.md');
  return files;
}

export function validateSkillFilePath(value: string): void {
  if (value.startsWith('/') || value.includes('\\') || /[\x00-\x1f:%]/u.test(value) || value.split('/').some(part =>
    !part || part === '.' || part === '..' || /[. ]$/u.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) {
    throw new Error('Unsafe Skill file path');
  }
  if (value.split('/').length > 9) throw new Error('Skill file path exceeds depth limit');
}

export function parseCopilotSkillPackage(input: unknown, source: CopilotSkillSource): CopilotSkillSnapshot {
  const files = validateSkillPackageFiles(input);
  const main = files.find(file => file.path === 'SKILL.md')!;
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(main.content);
  if (!match) throw new Error('SKILL.md requires YAML frontmatter with name and description');
  const document = parseDocument(match[1]!, { uniqueKeys: true, strict: true });
  if (document.errors.length || document.warnings.length) throw new Error('Invalid SKILL.md YAML frontmatter');
  const metadata = metadataSchema.parse(document.toJS({ maxAliasCount: 0 }));
  const requiredTools = dependencies(metadata);
  const incompatibilityReasons = unsupportedFeatures(metadata, files, requiredTools);
  return { name: metadata.name, description: metadata.description, version: String(metadata.version ?? '1.0.0'),
    content: match[2]!, files, source, requiredTools, incompatibilityReasons };
}

function dependencies(metadata: Record<string, unknown>): string[] {
  const declared = metadata['required-tools'] ?? metadata.requiredTools ?? metadata['allowed-tools'] ?? [];
  const values = typeof declared === 'string' ? declared.split(/[\s,]+/u).filter(Boolean) : declared;
  return [...new Set(z.array(z.string().min(1).max(160)).max(100).parse(values))];
}
function unsupportedFeatures(metadata: Record<string, unknown>, files: CopilotSkillFile[], requiredTools: string[]): string[] {
  const reasons: string[] = [];
  if (requiredTools.some(name => !/^[a-zA-Z0-9_.:-]+$/u.test(name))) reasons.push('unsupported_tool_permission_syntax: CLI permission patterns cannot grant Copilot tools');
  if (requiredTools.some(name => /^(Bash|Read|Write|Edit|MultiEdit|Grep|Glob|Task|WebFetch|WebSearch)(?:\(|$)/u.test(name))) reasons.push('unsupported_cli_tools: Skill requires CLI-native tools');
  if (files.some(file => /^scripts\//iu.test(file.path) || /\.(sh|bash|zsh|fish|py|pyc|js|mjs|cjs|ts|tsx|ps1|bat|cmd|exe|wasm)$/iu.test(file.path))) reasons.push('unsupported_scripts: Copilot does not execute Skill scripts');
  if ('hooks' in metadata || files.some(file => /^hooks\//iu.test(file.path))) reasons.push('unsupported_hooks: Copilot does not execute Skill hooks');
  if (metadata.context === 'fork' || 'agent' in metadata) reasons.push('unsupported_agent_execution: Skill requires a separate agent runtime');
  if (metadata['disable-model-invocation'] === true) reasons.push('manual_only: Skill disallows model invocation');
  return reasons;
}

export function packageMainFile(name: string, description: string, version: string, body: string): CopilotSkillFile {
  return { path: 'SKILL.md', content: `---\n${stringify({ name, description, version })}---\n${body}` };
}
