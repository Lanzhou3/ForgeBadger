import { describe, expect, it } from "vitest";
import { readSkillFiles, validateSkillFiles } from "./copilot-skill-files";
function file(path: string, content: string | Uint8Array): File {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return { name: path.split("/").at(-1)!, webkitRelativePath: path, size: bytes.length, arrayBuffer: async () => bytes.buffer } as File;
}
describe("Copilot UTF-8 file bundle input", () => {
  it("removes only the selected outer folder and preserves supporting paths", async () => {
    expect(await readSkillFiles([file("review/SKILL.md", "# Review"), file("review/references/check.md", "检查")])).toEqual([{ path: "SKILL.md", content: "# Review" }, { path: "references/check.md", content: "检查" }]);
  });
  it("rejects malformed UTF-8 instead of silently replacing bytes", async () => {
    await expect(readSkillFiles([file("SKILL.md", new Uint8Array([0xff, 0xfe]))])).rejects.toThrow();
  });
  it("rejects traversal, duplicates, missing root and oversized bundles", () => {
    const root = { path: "SKILL.md", content: "# Review" };
    for (const path of ["../secret", "/absolute", "scripts\\run", "a/../b", "a//b", "a:b"]) expect(() => validateSkillFiles([root, { path, content: "x" }])).toThrow();
    expect(() => validateSkillFiles([root, root])).toThrow();
    expect(() => validateSkillFiles([{ path: "nested/SKILL.md", content: "x" }])).toThrow();
    expect(() => validateSkillFiles([{ ...root, content: "x".repeat(128 * 1024 + 1) }])).toThrow();
    expect(() => validateSkillFiles([root, ...Array.from({ length: 64 }, (_, index) => ({ path: `ref/${index}.md`, content: "x".repeat(17000) }))])).toThrow();
  });
});
