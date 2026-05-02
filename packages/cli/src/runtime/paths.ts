import path from "node:path";
import { fileURLToPath } from "node:url";

export interface InstalledPaths {
  packageRoot: string;
  gatewayEntry: string;
  gatewayInitEntry: string;
  webServerEntry: string;
  webPublicDir: string;
}

export function resolveInstalledPaths(metaUrl = import.meta.url): InstalledPaths {
  const currentFile = fileURLToPath(metaUrl);
  const runtimeRoot = path.resolve(path.dirname(currentFile), "..");
  const packageRoot = path.basename(runtimeRoot) === "src" ? path.join(path.dirname(runtimeRoot), "dist") : runtimeRoot;

  return {
    packageRoot,
    gatewayEntry: path.join(packageRoot, "gateway", "src", "index.js"),
    gatewayInitEntry: path.join(packageRoot, "gateway", "src", "cli", "init.js"),
    webServerEntry: path.join(packageRoot, "web", "standalone", "packages", "web", "server.js"),
    webPublicDir: path.join(packageRoot, "web", "standalone", "packages", "web", "public")
  };
}
