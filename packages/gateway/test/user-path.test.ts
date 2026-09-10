import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { expandUserPath } from "../src/lib/user-path.js";
import { globalConfigRoot } from "../src/services/cli-config-target.js";

describe("expandUserPath", () => {
  it("expands POSIX and Windows tilde prefixes from the active user home", () => {
    const home = path.join(path.parse(process.cwd()).root, "Users", "tester");

    assert.equal(expandUserPath("~", home), home);
    assert.equal(expandUserPath("~/projects/demo", home), path.join(home, "projects", "demo"));
    assert.equal(expandUserPath("~\\projects\\demo", home), path.join(home, "projects", "demo"));
    assert.equal(expandUserPath("relative/project", home), "relative/project");
  });
});

describe("globalConfigRoot", () => {
  it("expands Windows-style home-relative CLI roots", () => {
    const homeDir = path.join(path.sep, "users", "tester");

    assert.equal(
      globalConfigRoot("codex", { env: { CODEX_HOME: "~\\codex-alt" }, homeDir }),
      path.join(homeDir, "codex-alt")
    );
  });
});
