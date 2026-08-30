import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";

import { resolveDshLauncherPath } from "../src/runtime/start-gateway.js";

describe("resolveDshLauncherPath", () => {
  it("uses an explicitly configured launcher file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-dsh-launcher-"));
    const launcherPath = path.join(root, "launcher.js");
    await writeFile(launcherPath, "export {};\n");

    assert.equal(resolveDshLauncherPath(launcherPath), launcherPath);
  });

  it("fails clearly when an enabled packaged runtime has no DSH launcher", () => {
    const packagedModuleUrl = pathToFileURL(
      path.join(tmpdir(), "forgebadger-package", "dist", "gateway", "src", "runtime", "start-gateway.js")
    ).href;

    assert.throws(
      () => resolveDshLauncherPath(undefined, packagedModuleUrl),
      /FORGEBADGER_DSH_BRIDGE_LAUNCHER.*required/i
    );
  });

  it("rejects a configured path that is not a file", () => {
    assert.throws(
      () => resolveDshLauncherPath(tmpdir()),
      /FORGEBADGER_DSH_BRIDGE_LAUNCHER.*file/i
    );
  });
});
