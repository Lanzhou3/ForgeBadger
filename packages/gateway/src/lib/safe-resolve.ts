import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";

export const DENIED_ROOTS = new Set([
  "/",
  "/etc",
  "/private/etc",
  "/proc",
  "/sys",
  "/dev",
  "/run",
  "/boot",
  "/root"
]);

export function validateProjectRoot(projectRoot: string): string {
  const resolvedRoot = realpathSync(projectRoot);

  if (DENIED_ROOTS.has(resolvedRoot)) {
    throw new Error(`Project root is a denied root: ${resolvedRoot}`);
  }

  for (const deniedRoot of DENIED_ROOTS) {
    if (deniedRoot !== "/" && isPathInside(resolvedRoot, deniedRoot)) {
      throw new Error(`Project root is under denied root: ${deniedRoot}`);
    }
  }

  return resolvedRoot;
}

export function safeResolve(projectRoot: string, userPath: string): string {
  if (isAbsolute(userPath)) {
    throw new Error("Project-relative path required; absolute paths are not allowed");
  }

  if (containsTraversal(userPath)) {
    throw new Error("Resolved path escapes approved project root");
  }

  const approvedRoot = validateProjectRoot(projectRoot);
  const candidate = resolve(approvedRoot, userPath);
  const pathToCheck = existingRealPath(candidate);

  if (!isPathInsideOrEqual(pathToCheck, approvedRoot)) {
    throw new Error("Resolved path escapes approved project root");
  }

  return candidate;
}

function containsTraversal(value: string): boolean {
  const decoded = normalizePathSeparators(decodeRepeatedly(value));
  return decoded.split(/[\\/]+/u).some((part) => part === "..");
}

function normalizePathSeparators(value: string): string {
  return value.replaceAll("\u2215", "/").replaceAll("\u2044", "/").replaceAll("\uff0f", "/");
}

function decodeRepeatedly(value: string): string {
  let current = value;

  for (let index = 0; index < 3; index += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) {
        return decoded;
      }
      current = decoded;
    } catch {
      return current;
    }
  }

  return current;
}

function existingRealPath(pathname: string): string {
  if (existsSync(pathname)) {
    return realpathSync(pathname);
  }

  let current = dirname(pathname);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      return current;
    }
    current = parent;
  }

  return realpathSync(current);
}

function isPathInsideOrEqual(child: string, parent: string): boolean {
  return child === parent || isPathInside(child, parent);
}

function isPathInside(child: string, parent: string): boolean {
  const parentWithSeparator = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return child.startsWith(parentWithSeparator);
}
