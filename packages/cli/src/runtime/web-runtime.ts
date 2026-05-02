import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface WriteWebRuntimeConfigOptions {
  webPublicDir: string;
  gatewayBaseUrl: string;
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
