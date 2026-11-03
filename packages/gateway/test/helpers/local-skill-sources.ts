import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after } from "node:test";

/** Keep config tests independent of the developer's installed Skill packages. */
export function isolateLocalSkillSources(): void {
  const root = mkdtempSync(path.join(tmpdir(), "forgebadger-test-skill-sources-"));
  const overrides = {
    CLAUDE_CONFIG_DIR: path.join(root, "claude"),
    AGENTS_HOME: path.join(root, "agents"),
    FORGEBADGER_SKILL_DIRS: ""
  };
  const previous = new Map(Object.keys(overrides).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
  after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
}
