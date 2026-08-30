import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { buildRootEnv, buildRunCommand } from "./run-with-root-env.mjs";

describe("run-with-root-env", () => {
  it("loads root .env values without overriding inherited environment", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-root-env-"));
    await writeFile(
      path.join(root, ".env"),
      [
        "FORGEBADGER_DB_PATH=/repo/forgebadger.db",
        "FORGEBADGER_PORT=48731",
        "NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:48731"
      ].join("\n")
    );

    const env = await buildRootEnv({
      rootDir: root,
      env: {
        FORGEBADGER_DB_PATH: "/tmp/operator/forgebadger.db",
        EXISTING_EMPTY: "",
        UNDEFINED_VALUE: undefined
      }
    });

    assert.equal(env.FORGEBADGER_DB_PATH, "/tmp/operator/forgebadger.db");
    assert.equal(env.FORGEBADGER_PORT, "48731");
    assert.equal(env.NEXT_PUBLIC_GATEWAY_URL, "http://127.0.0.1:48731");
    assert.equal(env.EXISTING_EMPTY, "");
    assert.equal("UNDEFINED_VALUE" in env, false);
  });

  it("maps legacy OpenForge variables to ForgeBadger names with new names winning", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-root-env-legacy-"));
    await writeFile(
      path.join(root, ".env"),
      [
        "OPENFORGE_WEB_HOST=0.0.0.0",
        "OPENFORGE_WEB_PORT=48733",
        "OPENFORGE_PORT=48731",
        "OPENFORGE_DB_PATH=/repo/openforge.db",
        "FORGEBADGER_PORT=49831"
      ].join("\n")
    );

    const env = await buildRootEnv({
      rootDir: root,
      env: {
        OPENFORGE_WEB_PORT: "48734",
        FORGEBADGER_WEB_HOST: "127.0.0.1"
      }
    });

    assert.equal(env.FORGEBADGER_WEB_HOST, "127.0.0.1");
    assert.equal(env.FORGEBADGER_WEB_PORT, "48734");
    assert.equal(env.FORGEBADGER_PORT, "49831");
    assert.equal(env.FORGEBADGER_DB_PATH, "/repo/openforge.db");
  });

  it("builds direct and shell command invocations", () => {
    assert.deepEqual(buildRunCommand(["tsx", "watch", "src/index.ts"], { shell: "/bin/zsh" }), {
      command: "tsx",
      args: ["watch", "src/index.ts"]
    });

    assert.deepEqual(
      buildRunCommand(["--shell", "next dev -H ${FORGEBADGER_WEB_HOST:-127.0.0.1}"], {
        shell: "/bin/zsh"
      }),
      {
        command: "/bin/zsh",
        args: ["-lc", "next dev -H ${FORGEBADGER_WEB_HOST:-127.0.0.1}"]
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
      "node ../../scripts/run-with-root-env.mjs --shell 'next dev -H ${FORGEBADGER_WEB_HOST:-127.0.0.1} -p ${FORGEBADGER_WEB_PORT:-48732}'"
    );
    assert.equal(
      webPackage.scripts.start,
      "node ../../scripts/run-with-root-env.mjs --shell 'next start -H ${FORGEBADGER_WEB_HOST:-127.0.0.1} -p ${FORGEBADGER_WEB_PORT:-48732}'"
    );
  });
});
