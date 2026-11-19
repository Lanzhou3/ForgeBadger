import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ProjectRepository } from '../../db/repositories/project-repository.js';
import { safeResolve, validateProjectRoot } from '../../lib/safe-resolve.js';
import type { CommandContext } from '../platform-commands/types.js';

export const MAX_SOURCE_BYTES = 64 * 1024;
export const hashText = (value: string) => createHash('sha256').update(value).digest('hex');

export const sourcePathSchema = z.string().min(1).max(512).refine(value => {
  if (value.startsWith('/') || value.includes('\\') || /[\x00-\x1f\x7f:]/.test(value)) return false;
  return value.split('/').every(p => p.length > 0 && p !== '..' && !p.startsWith('.') && p !== 'node_modules');
}, 'Expected a non-hidden relative source path');

export function ownedProject(ctx: Pick<CommandContext, 'db' | 'userId'>, projectId: string) {
  const project = new ProjectRepository(ctx.db, ctx.userId).getById(projectId);
  if (!project) throw new Error('DEVELOPMENT_PROJECT_NOT_FOUND');
  return project;
}

export function permittedSourcePath(value: string): string {
  sourcePathSchema.parse(value);
  if (/(^|[/_.-])(credentials?|secrets?|passwords?|id_rsa|id_ed25519)([/_.-]|$)/i.test(value)
    || /\.(pem|p12|pfx|key|db|sqlite|sqlite3|crt|cer|node|wasm)$/i.test(value)) {
    throw new Error('DEVELOPMENT_SOURCE_FORBIDDEN');
  }
  return value;
}

export function sourcePath(root: string, value: string, mustExist = true): string {
  permittedSourcePath(value);
  const canonical = fs.realpathSync(root);
  validateProjectRoot(canonical);
  let current = canonical;
  for (const part of value.split('/')) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('DEVELOPMENT_SYMLINK_FORBIDDEN');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  const resolved = safeResolve(canonical, value);
  if (mustExist && !fs.existsSync(resolved)) throw new Error('DEVELOPMENT_SOURCE_MISSING');
  return resolved;
}

export function readSource(root: string, value: string, maxBytes = MAX_SOURCE_BYTES) {
  const target = sourcePath(root, value);
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error('DEVELOPMENT_SOURCE_NOT_REGULAR');
    if (stat.size > maxBytes) throw new Error('DEVELOPMENT_SOURCE_TOO_LARGE');
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = fs.readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    const data = buffer.subarray(0, size);
    if (data.length > maxBytes || data.includes(0)) throw new Error('DEVELOPMENT_SOURCE_NOT_TEXT');
    const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
    return { path: value, content, sha256: hashText(content), bytes: data.length };
  } finally {
    fs.closeSync(fd);
  }
}

export function listSourceFiles(root: string, directory = '', limit = 100, offset = 0) {
  const start = directory ? sourcePath(root, directory) : fs.realpathSync(root);
  validateProjectRoot(start);
  const files: string[] = [];
  let visited = 0;
  let truncated = false;
  function walk(dir: string, depth: number) {
    if (depth > 10 || visited > 20_000 || files.length >= limit + offset + 1) {
      truncated = true;
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++visited > 20_000 || files.length >= limit + offset + 1) {
        truncated = true;
        return;
      }
      const full = path.join(dir, entry.name);
      const relative = path.relative(fs.realpathSync(root), full).split(path.sep).join('/');
      try {
        permittedSourcePath(relative);
      } catch {
        continue;
      }
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!['dist', 'build', 'coverage', 'vendor'].includes(entry.name)) walk(full, depth + 1);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  }
  walk(start, 0);
  return {
    files: files.slice(offset, offset + limit),
    truncated: truncated || files.length > offset + limit,
    nextOffset: files.length > offset + limit ? offset + limit : null,
    scanLimitReached: visited > 20_000
  };
}
