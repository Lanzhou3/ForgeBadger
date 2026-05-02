import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { safeResolve } from "../lib/safe-resolve.js";
import type { PluginDefinition } from "./plugin-catalog.js";

export interface MaterializedClaudePluginPackage {
  pluginId: string;
  version: string;
  directory: string;
  checksum: string;
  manifestPath: string;
  metadataPath: string;
}

interface GeneratedPluginFile {
  relativePath: string;
  content: string;
}

interface PluginMetadata {
  pluginId: string;
  version: string;
  checksum: string;
  generatedBy: "openforge";
  generatedAt: string;
  files: string[];
}

export async function materializeClaudePluginPackages(
  projectRoot: string,
  plugins: PluginDefinition[]
): Promise<MaterializedClaudePluginPackage[]> {
  const packages: MaterializedClaudePluginPackage[] = [];

  for (const plugin of plugins) {
    const directory = pluginPackageDirectory(projectRoot, plugin.id);
    const files = generatedPluginFiles(plugin);
    const checksum = checksumFiles(files);
    await mkdir(directory, { recursive: true });

    for (const file of files) {
      const target = safeResolve(directory, file.relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf8");
    }

    const metadata: PluginMetadata = {
      pluginId: plugin.id,
      version: plugin.version,
      checksum,
      generatedBy: "openforge",
      generatedAt: new Date().toISOString(),
      files: files.map((file) => file.relativePath)
    };
    const metadataPath = safeResolve(directory, ".openforge/metadata.json");
    await mkdir(path.dirname(metadataPath), { recursive: true });
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

    const validated = await validateClaudePluginPackage(directory, plugin);
    if (!validated) {
      throw new Error(`Claude plugin package failed validation: ${plugin.id}`);
    }
    packages.push(validated);
  }

  return packages;
}

export async function validateClaudePluginPackage(
  directory: string,
  plugin: PluginDefinition
): Promise<MaterializedClaudePluginPackage | undefined> {
  try {
    const files = generatedPluginFiles(plugin);
    const checksum = checksumFiles(files);
    const manifestPath = safeResolve(directory, ".claude-plugin/plugin.json");
    const metadataPath = safeResolve(directory, ".openforge/metadata.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Partial<{
      name: string;
      version: string;
      description: string;
    }>;
    if (manifest.name !== plugin.id || manifest.version !== plugin.version) {
      return undefined;
    }

    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Partial<PluginMetadata>;
    if (
      metadata.pluginId !== plugin.id ||
      metadata.version !== plugin.version ||
      metadata.checksum !== checksum
    ) {
      return undefined;
    }

    for (const file of files) {
      const actual = await readFile(safeResolve(directory, file.relativePath), "utf8");
      if (actual !== file.content) {
        return undefined;
      }
    }

    return {
      pluginId: plugin.id,
      version: plugin.version,
      directory,
      checksum,
      manifestPath,
      metadataPath
    };
  } catch {
    return undefined;
  }
}

function pluginPackageDirectory(projectRoot: string, pluginId: string): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(pluginId)) {
    throw new Error("Invalid plugin id");
  }
  return safeResolve(projectRoot, `.openforge/claude-plugins/${pluginId}`);
}

function generatedPluginFiles(plugin: PluginDefinition): GeneratedPluginFile[] {
  const manifest = {
    name: plugin.id,
    description: plugin.description,
    version: plugin.version,
    author: {
      name: "OpenForge"
    }
  };
  return [
    {
      relativePath: ".claude-plugin/plugin.json",
      content: `${JSON.stringify(manifest, null, 2)}\n`
    },
    ...plugin.skills.map((skill) => ({
      relativePath: `skills/${skill.name}/SKILL.md`,
      content: `${skill.content.trim()}\n`
    }))
  ];
}

function checksumFiles(files: GeneratedPluginFile[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}
