import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { safeResolve, validateProjectRoot } from '../lib/safe-resolve.js';
import type { TemplateFileInput } from '../config-generation/types.js';

export const SKILL_MANIFEST_FILE = '.forgebadger-skill.json';
export const MAX_RESOURCE_FILES = 256;
export const MAX_RESOURCE_BYTES = 4 * 1024 * 1024;
export const MAX_RESOURCE_FILE_BYTES = 128 * 1024;
const MAX_FILE_BYTES = MAX_RESOURCE_FILE_BYTES;
const MAX_EXPORT_MANIFEST_BYTES = 1024 * 1024;
const ignoredResourceNames = new Set([
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.cache',
  '.git', 'node_modules', '.DS_Store'
]);

/** Generated caches and dependencies are not part of the portable Skill package. */
export function isIgnoredSkillResource(name: string): boolean {
  return ignoredResourceNames.has(name) || /\.(pyc|pyo)$/iu.test(name);
}
const fileSchema = z.object({relativePath:z.string().min(1).max(512),content:z.string().max(MAX_FILE_BYTES)}).strict();
const exportManifestSchema = z.object({version:z.literal(1),files:z.array(z.object({relativePath:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/u)}).strict()).max(MAX_RESOURCE_FILES+1)}).strict();
const manifestSchema = z.object({version:z.literal(1),kind:z.literal('utf8-package'),sourcePath:z.string().max(4096),files:z.array(fileSchema).max(MAX_RESOURCE_FILES)}).strict();

export function resourcePath(value: string): string {
  const parts = value.split('/');
  if (value.length > 512 || value.includes('\\') || /[\x00-\x1f:%]/u.test(value) || path.posix.isAbsolute(value)
    || parts.some(part=>!part || part==='.' || part==='..' || /[. ]$/u.test(part)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) {
    throw new Error('Unsafe Skill resource path');
  }
  return value;
}

/** Snapshot contained UTF-8 text resources. Unsupported packages are rejected whole. */
export function readSkillResourceManifest(skillPath: string): string {
  const root = validateProjectRoot(path.dirname(skillPath));
  const files: Array<{relativePath:string;content:string}> = [];
  // The package limit includes the root document, just like remote package validation.
  let totalBytes = statSync(skillPath).size;
  function walk(directory: string, depth: number): void {
    if (depth>8) throw new Error(`${path.relative(root,directory)}: Skill package exceeds directory depth limit`);
    for (const entry of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (isIgnoredSkillResource(entry.name)) continue;
      const relativePath = resourcePath(path.relative(root,path.join(directory,entry.name)).split(path.sep).join('/'));
      const resolved = safeResolve(root,relativePath);
      if (lstatSync(resolved).isSymbolicLink()) throw new Error(`${relativePath}: Skill package symlinks are not supported`);
      const stats = statSync(resolved);
      if (stats.isDirectory()) { walk(resolved,depth+1); continue; }
      if (!stats.isFile()) throw new Error(`${relativePath}: Skill package contains unsupported file type`);
      if (relativePath===SKILL_MANIFEST_FILE) {
        if(stats.size>MAX_EXPORT_MANIFEST_BYTES) throw new Error(`${relativePath}: Skill export manifest exceeds review limit`);
        const metadata=exportManifestSchema.parse(JSON.parse(readFileSync(resolved,'utf8')));
        for(const file of metadata.files) resourcePath(file.relativePath);
        continue;
      }
      if (relativePath==='SKILL.md') continue;
      if (files.length>=MAX_RESOURCE_FILES) throw new Error(`${relativePath}: Skill package exceeds ${MAX_RESOURCE_FILES} resource file count limit`);
      if (stats.size>MAX_FILE_BYTES) throw new Error(`${relativePath}: Skill resource exceeds 128 KiB file size limit`);
      const bytes = readFileSync(resolved);
      totalBytes += bytes.length;
      if (bytes.length>MAX_FILE_BYTES) throw new Error(`${relativePath}: Skill resource exceeds 128 KiB file size limit`);
      if (totalBytes>MAX_RESOURCE_BYTES) throw new Error(`${relativePath}: Skill package exceeds 4 MiB total size limit`);
      const content = decodeResource(bytes,relativePath);
      files.push({relativePath,content});
    }
  }
  walk(root,0);
  return JSON.stringify({version:1,kind:'utf8-package',sourcePath:realpathSync(skillPath),files});
}

function decodeResource(bytes: Buffer, relativePath: string): string {
  let content: string;
  try {
    content = new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  } catch {
    throw new Error(`${relativePath}: Skill resource is not valid UTF-8 text; binary assets are unsupported`);
  }
  if (content.includes('\0')) throw new Error(`${relativePath}: Skill package contains binary resources; UTF-8 text only`);
  return content;
}

export function parseSkillResourceManifest(value: string | null | undefined) {
  if (!value) return [];
  if (Buffer.byteLength(value,'utf8')>MAX_RESOURCE_BYTES*2) throw new Error('Skill resource manifest too large');
  const parsed = manifestSchema.parse(JSON.parse(value));
  let bytes = 0;
  const names = new Set<string>();
  for (const file of parsed.files) {
    resourcePath(file.relativePath);
    const key = file.relativePath.toLowerCase();
    if (key==='skill.md' || key===SKILL_MANIFEST_FILE || names.has(key)) throw new Error('Duplicate or reserved Skill resource path');
    names.add(key);
    const size = Buffer.byteLength(file.content,'utf8');bytes+=size;
    if (file.content.includes('\0') || size>MAX_FILE_BYTES || bytes>MAX_RESOURCE_BYTES) throw new Error('Invalid Skill resource contents');
  }
  return parsed.files;
}

/** Track exported paths for review of obsolete resources; never deletes files. */
export function skillExportManifest(id: string, directory: string, files: TemplateFileInput[]): TemplateFileInput {
  return {renderVariables:false,id:`skill-manifest:${id}`,relativePath:`${directory}/${SKILL_MANIFEST_FILE}`,content:JSON.stringify({
    version:1, files:files.map(file=>({relativePath:file.relativePath.slice(directory.length+1),sha256:createHash('sha256').update(file.content).digest('hex')}))
  },null,2)+'\n'};
}

export function assertUniqueConfigPaths(files: TemplateFileInput[]): void {
  const paths = new Set<string>();
  for (const file of files) {
    const normalized = path.posix.normalize(file.relativePath.replaceAll('\\','/')).toLowerCase();
    if (paths.has(normalized)) throw new Error(`Duplicate config output path: ${file.relativePath}`);
    paths.add(normalized);
  }
  for (const name of paths) {
    const parts=name.split('/');parts.pop();
    while(parts.length) {
      if(paths.has(parts.join('/'))) throw new Error(`Config file/directory collision: ${name}`);
      parts.pop();
    }
  }
}

/** Check only tracked export manifests, never infer ownership from an arbitrary filename. */
export function assertNoObsoleteSkillResources(root: string, skillsDirectory: string, planned: TemplateFileInput[]): void {
  const directory = safeResolve(root,skillsDirectory);
  if (!existsSync(directory)) return;
  const expected = new Set(planned.map(file=>file.relativePath));
  const obsolete: string[] = [];
  const entries = readdirSync(directory,{withFileTypes:true});
  if (entries.length>2000) throw new Error('Skill directory exceeds review limit');
  for (const entry of entries) {
    const manifestRelative = `${skillsDirectory}/${entry.name}/${SKILL_MANIFEST_FILE}`;
    const manifestPath = safeResolve(root,manifestRelative);
    if (!existsSync(manifestPath)) continue;
    if(statSync(manifestPath).size>MAX_EXPORT_MANIFEST_BYTES) throw new Error('Skill export manifest exceeds review limit');
    const manifest = exportManifestSchema.parse(JSON.parse(readFileSync(manifestPath,'utf8')));
    for(const file of manifest.files) {
      const relative = `${skillsDirectory}/${entry.name}/${resourcePath(file.relativePath)}`;
      if(!expected.has(relative) && existsSync(safeResolve(root,relative))) obsolete.push(relative);
    }
  }
  if(obsolete.length) throw new Error(`Obsolete Skill resources require owner review; no files removed: ${obsolete.join(', ')}`);
}
