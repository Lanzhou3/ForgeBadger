import { createHash } from "node:crypto";
import { parseDocument } from "yaml";
import { z } from "zod";
import {
  parseSkillResourceManifest,
  resourcePath,
  SKILL_MANIFEST_FILE,
} from "./skill-resources.js";

export interface SkillPackageFile {
  path: string;
  content: string;
}
export interface SkillPackage {
  name: string;
  description: string;
  version: string;
  license?: string | undefined;
  compatibility?: string | undefined;
  warnings: string[];
  files: SkillPackageFile[];
  packageHash: string;
  sizeBytes: number;
}
export const MAX_SKILL_FILES = 65;
export const MAX_SKILL_FILE_BYTES = 128 * 1024;
export const MAX_SKILL_PACKAGE_BYTES = 1024 * 1024;

export function readSkillMetadata(content: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
  if (!match) return {};
  const document = parseDocument(match[1]!, { uniqueKeys: true, strict: true });
  if (document.errors.length || document.warnings.length)
    throw new Error("Invalid Skill YAML frontmatter");
  return z.record(z.unknown()).parse(document.toJS({ maxAliasCount: 0 }));
}

export function skillPackageHash(files: SkillPackageFile[]): string {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify(
        [...files]
          .sort((a, b) => a.path.localeCompare(b.path))
          .map((file) => [file.path, file.content]),
      ),
    )
    .digest("hex")}`;
}

export function validateSkillFiles(input: unknown): SkillPackageFile[] {
  const files = z
    .array(
      z
        .object({ path: z.string().min(1).max(512), content: z.string() })
        .strict(),
    )
    .min(1)
    .max(MAX_SKILL_FILES)
    .parse(input);
  const paths = new Set<string>();
  let total = 0;
  for (const file of files) {
    resourcePath(file.path);
    const key = file.path.toLowerCase();
    if (
      file.path.split("/").length > 9 ||
      key === SKILL_MANIFEST_FILE ||
      key === ".forgebadger-managed.json" ||
      paths.has(key)
    )
      throw new Error("Duplicate, reserved or too-deep Skill file path");
    paths.add(key);
    const size = Buffer.byteLength(file.content, "utf8");
    total += size;
    if (size > MAX_SKILL_FILE_BYTES || total > MAX_SKILL_PACKAGE_BYTES)
      throw new Error(
        "Skill package exceeds 128 KiB/file or 1 MiB total limit",
      );
    if (
      file.content.includes("\0") ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
        file.content,
      )
    )
      throw new Error(
        "Skill resources must be valid UTF-8 text; binary assets are unsupported",
      );
  }
  for (const key of paths) {
    const parts = key.split("/");
    parts.pop();
    while (parts.length) {
      if (paths.has(parts.join("/")))
        throw new Error("Skill file/directory collision");
      parts.pop();
    }
  }
  if (!files.some((file) => file.path === "SKILL.md"))
    throw new Error("Skill package requires root SKILL.md");
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function parseSkillPackage(input: unknown): SkillPackage {
  const files = validateSkillFiles(input);
  const metadata = readSkillMetadata(
    files.find((file) => file.path === "SKILL.md")!.content,
  );
  const name = z.string().trim().min(1).max(64).parse(metadata.name);
  // Some public registries use display names. Keep the original file; use a safe local slug.
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  if (!slug)
    throw new Error("Skill name must contain ASCII letters or numbers");
  const description = z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .parse(metadata.description);
  const extra = z.record(z.unknown()).safeParse(metadata.metadata);
  const rawVersion =
    metadata.version ??
    (extra.success ? extra.data.version : undefined) ??
    "1.0.0";
  const version = String(
    z.union([z.string().max(128), z.number().finite()]).parse(rawVersion),
  );
  const warnings: string[] = [];
  if (name !== slug) warnings.push("nonstandard-name");
  if (files.some((file) => file.path.startsWith("scripts/")))
    warnings.push("contains-scripts");
  if (
    "hooks" in metadata ||
    files.some((file) => file.path.startsWith("hooks/"))
  )
    warnings.push("requires-hooks");
  if ("allowed-tools" in metadata) warnings.push("requires-cli-tools");
  if (metadata.context === "fork" || "agent" in metadata)
    warnings.push("requires-agent-runtime");
  const license =
    typeof metadata.license === "string"
      ? metadata.license.slice(0, 1024)
      : undefined;
  const compatibility =
    typeof metadata.compatibility === "string"
      ? metadata.compatibility.slice(0, 2048)
      : undefined;
  return {
    name: slug,
    description,
    version,
    license,
    compatibility,
    warnings,
    files,
    packageHash: skillPackageHash(files),
    sizeBytes: files.reduce(
      (n, file) => n + Buffer.byteLength(file.content),
      0,
    ),
  };
}

export function packageResourceManifest(
  pkg: SkillPackage,
  source: string,
): string {
  return JSON.stringify({
    version: 1,
    kind: "utf8-package",
    sourcePath: source,
    files: pkg.files
      .filter((file) => file.path !== "SKILL.md")
      .map((file) => ({ relativePath: file.path, content: file.content })),
  });
}

export function storedSkillFiles(skill: {
  content: string;
  resourceManifest?: string | null;
}): SkillPackageFile[] {
  return [
    { path: "SKILL.md", content: skill.content },
    ...parseSkillResourceManifest(skill.resourceManifest).map((file) => ({
      path: file.relativePath,
      content: file.content,
    })),
  ];
}
