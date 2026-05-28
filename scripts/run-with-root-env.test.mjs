import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { buildRootEnv, buildRunCommand } from "./run-with-root-env.mjs";

describe("run-with-root-env", () => {
  it("loads root .env values without overriding inherited environment", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openforge-root-env-"));
    await writeFile(
      path.join(root, ".env"),
      [
        "OPENFORGE_DB_PATH=/repo/openforge.db",
        "OPENFORGE_PORT=48731",
        "NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:48731"
      ].join("\n")
    );

    const env = await buildRootEnv({
      rootDir: root,
      env: {
        OPENFORGE_DB_PATH: "/tmp/operator/openforge.db",
        EXISTING_EMPTY: "",
        UNDEFINED_VALUE: undefined
      }
    });

    assert.equal(env.OPENFORGE_DB_PATH, "/tmp/operator/openforge.db");
    assert.equal(env.OPENFORGE_PORT, "48731");
    assert.equal(env.NEXT_PUBLIC_GATEWAY_URL, "http://127.0.0.1:48731");
    assert.equal(env.EXISTING_EMPTY, "");
    assert.equal("UNDEFINED_VALUE" in env, false);
  });

  it("builds direct and shell command invocations", () => {
    assert.deepEqual(buildRunCommand(["tsx", "watch", "src/index.ts"], { shell: "/bin/zsh" }), {
      command: "tsx",
      args: ["watch", "src/index.ts"]
    });

    assert.deepEqual(
      buildRunCommand(["--shell", "next dev -H ${OPENFORGE_WEB_HOST:-127.0.0.1}"], {
        shell: "/bin/zsh"
      }),
      {
        command: "/bin/zsh",
        args: ["-lc", "next dev -H ${OPENFORGE_WEB_HOST:-127.0.0.1}"]
      }
    );
  });

  it("wires source package scripts through the preserving env runner", async () => {
    const gatewayPackage = JSON.parse(await readFile("packages/gateway/package.json", "utf8"));
    const webPackage = JSON.parse(await readFile("packages/web/package.json", "utf8"));

    assert.equal(
      gatewayPackage.scripts.dev,
      "node ../../scripts/run-with-root-env.mjs tsx watch src/index.ts"
    );
    assert.equal(
      gatewayPackage.scripts.start,
      "node ../../scripts/run-with-root-env.mjs node dist/src/index.js"
    );
    assert.equal(webPackage.scripts.build, "node ../../scripts/run-with-root-env.mjs next build");
    assert.equal(
      webPackage.scripts.dev,
      "node ../../scripts/run-with-root-env.mjs --shell 'next dev -H ${OPENFORGE_WEB_HOST:-127.0.0.1} -p ${OPENFORGE_WEB_PORT:-48732}'"
    );
    assert.equal(
      webPackage.scripts.start,
      "node ../../scripts/run-with-root-env.mjs --shell 'next start -H ${OPENFORGE_WEB_HOST:-127.0.0.1} -p ${OPENFORGE_WEB_PORT:-48732}'"
    );
  });
});
