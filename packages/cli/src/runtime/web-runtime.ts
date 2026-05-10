import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface WriteWebRuntimeConfigOptions {
  webPublicDir: string;
  gatewayBaseUrl: string;
}

export interface PrepareWebRuntimeOptions {
  installedWebServerEntry: string;
  runtimeWebDir: string;
}

export interface PreparedWebRuntime {
  webRootDir: string;
  webServerEntry: string;
  webPublicDir: string;
}

export async function prepareWebRuntime(options: PrepareWebRuntimeOptions): Promise<PreparedWebRuntime> {
  const installedWebRoot = resolveInstalledWebRoot(options.installedWebServerEntry);
  const runtimeWebDir = assertSafeRuntimeWebDir(options.runtimeWebDir);

  await rm(runtimeWebDir, { recursive: true, force: true });
  await mkdir(path.dirname(runtimeWebDir), { recursive: true });
  await cp(installedWebRoot, runtimeWebDir, { recursive: true });

  return {
    webRootDir: runtimeWebDir,
    webServerEntry: path.join(runtimeWebDir, "packages", "web", "server.js"),
    webPublicDir: path.join(runtimeWebDir, "packages", "web", "public")
  };
}

export async function writeWebRuntimeConfig(options: WriteWebRuntimeConfigOptions): Promise<string> {
  await mkdir(options.webPublicDir, { recursive: true });
  const filePath = path.join(options.webPublicDir, "openforge-runtime.js");
  const content = `window.__OPENFORGE_RUNTIME__ = ${JSON.stringify({
    gatewayBaseUrl: options.gatewayBaseUrl
  })};\n`;
  await writeFile(filePath, content, { mode: 0o644 });
  return filePath;
}

function resolveInstalledWebRoot(installedWebServerEntry: string): string {
  return path.resolve(path.dirname(installedWebServerEntry), "..", "..");
}

export function assertSafeRuntimeWebDir(runtimeWebDir: string): string {
  const resolved = path.resolve(runtimeWebDir);
  const runtimeDir = path.dirname(resolved);
  const stateDir = path.dirname(runtimeDir);
  const root = path.parse(resolved).root;
  const expected = path.join(stateDir, "runtime", "web");
  if (
    resolved !== expected ||
    stateDir === root ||
    isSensitiveStateDir(stateDir)
  ) {
    throw new Error(`unsafe runtime Web directory: ${runtimeWebDir}`);
  }
  return resolved;
}

function isSensitiveStateDir(stateDir: string): boolean {
  const normalized = path.resolve(stateDir);
  const sensitiveRoots = ["/etc", "/proc", "/sys"];
  return sensitiveRoots.some((root) => normalized === root || normalized.startsWith(`${root}${path.sep}`));
}
