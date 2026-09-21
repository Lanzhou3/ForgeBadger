import type { ExtensionFile } from "./copilot-extensions-api";
export function validateSkillFiles(files: ExtensionFile[]): void {
  if (!files.length || files.length > 65 || !files.some(file => file.path === "SKILL.md")) throw new Error("invalid_skill_package");
  const paths = new Set<string>(); let total = 0;
  for (const file of files) {
    if (!file.path || file.path.startsWith("/") || /[\\\u0000-\u001f:]/.test(file.path) || file.path.split("/").some(part => !part || part === "." || part === "..") || paths.has(file.path)) throw new Error("invalid_skill_path");
    paths.add(file.path);
    const size = new TextEncoder().encode(file.content).byteLength;
    total += size;
    if (size > 128 * 1024 || file.content.includes("\u0000") || total > 1024 * 1024) throw new Error("skill_package_too_large_or_binary");
  }
}
export async function readSkillFiles(selected: FileList | File[]): Promise<ExtensionFile[]> {
  const input = Array.from(selected);
  if (input.length > 65 || input.some(file => file.size > 128 * 1024) || input.reduce((sum, file) => sum + file.size, 0) > 1024 * 1024) throw new Error("skill_package_too_large");
  const paths = input.map(file => file.webkitRelativePath || file.name);
  const prefix = paths[0]?.split("/")[0];
  const stripRoot = prefix && paths.every(path => path.startsWith(`${prefix}/`)) && paths.includes(`${prefix}/SKILL.md`);
  const files: ExtensionFile[] = [];
  for (const [index, file] of input.entries()) {
    files.push({ path: stripRoot ? paths[index]!.slice(prefix.length + 1) : paths[index]!, content: new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()) });
  }
  validateSkillFiles(files);
  return files;
}
