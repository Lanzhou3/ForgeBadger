import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type PackageJsonReader = (filePath: string) => Promise<string>;

export interface ResolveCliVersionOptions {
  readFileImpl?: PackageJsonReader;
}

/**
 * Reads the CLI version from the package.json two levels above this module
 * (src/runtime/ in dev, dist/runtime/ when published — both resolve to the
 * package root).
 */
export async function resolveCliVersion(
  metaUrl = import.meta.url,
  options: ResolveCliVersionOptions = {}
): Promise<string> {
  const reader = options.readFileImpl ?? ((filePath: string) => readFile(filePath, "utf8"));
  const packageJsonPath = path.join(path.dirname(fileURLToPath(metaUrl)), "..", "..", "package.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await reader(packageJsonPath));
  } catch (error) {
    throw new Error(`Unable to read CLI package version from ${packageJsonPath}`, { cause: error });
  }
  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== "string" || !version) {
    throw new Error(`Missing version field in ${packageJsonPath}`);
  }
  return version;
}
