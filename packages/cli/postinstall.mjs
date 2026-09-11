import { constants, closeSync, fchmodSync, fstatSync, lstatSync, openSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

/** Backport the missing execute bits in node-pty 1.1.0's Darwin prebuild.
 * Resolves only this package's dependency; never scans the package store or
 * installs system software. Safe to run before the CLI has been compiled.
 */
export function repairNodePtyHelper({
  platform = process.platform,
  arch = process.arch,
  resolvePackage = () => require.resolve("node-pty/package.json")
} = {}) {
  if (platform !== "darwin") return "skipped";
  if (arch !== "arm64" && arch !== "x64") return "skipped";
  const packageRoot = realpathSync(dirname(resolvePackage()));
  const helper = join(packageRoot, "prebuilds", `darwin-${arch}`, "spawn-helper");
  let stat;
  try { stat = lstatSync(helper); }
  catch (error) {
    // Source-built versions may not ship a prebuild helper.
    if (error.code === "ENOENT") return "missing";
    throw error;
  }
  if (!stat.isFile() || !realpathSync(helper).startsWith(`${packageRoot}${sep}`)) {
    throw new Error("Refusing to change an unsafe node-pty spawn-helper path");
  }
  if ((stat.mode & 0o111) === 0o111) return "unchanged";
  const fd = openSync(helper, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const current = fstatSync(fd);
    if (!current.isFile()) throw new Error("node-pty spawn-helper is not a regular file");
    fchmodSync(fd, (current.mode & 0o777) | 0o111);
  } finally { closeSync(fd); }
  return "repaired";
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  repairNodePtyHelper();
}
