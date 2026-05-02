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

  await rm(options.runtimeWebDir, { recursive: true, force: true });
  await mkdir(path.dirname(options.runtimeWebDir), { recursive: true });
  await cp(installedWebRoot, options.runtimeWebDir, { recursive: true });

  return {
    webRootDir: options.runtimeWebDir,
    webServerEntry: path.join(options.runtimeWebDir, "packages", "web", "server.js"),
    webPublicDir: path.join(options.runtimeWebDir, "packages", "web", "public")
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
