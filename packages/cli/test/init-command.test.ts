import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { runInit } from "../src/commands/init.js";
import { parseCliArgs, runCli } from "../src/index.js";

describe("init command delegation", () => {
  it("keeps the command token for gateway init parser", () => {
    assert.deepEqual(parseCliArgs(["init", "--path", "/tmp/project"]), {
      command: "init",
      args: ["init", "--path", "/tmp/project"]
    });
  });

  it("dispatches init through an injectable runner with original args", async () => {
    const seen: string[][] = [];

    const code = await runCli(["init", "--path", "/tmp/project", "--dry-run"], {
      initRunner: async (args) => {
        seen.push(args);
        return 11;
      }
    });

    assert.equal(code, 11);
    assert.deepEqual(seen, [["init", "--path", "/tmp/project", "--dry-run"]]);
  });

  it("dynamically imports the installed gateway init module and calls runForgeBadgerCli", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "forgebadger-init-command-"));
    const argsPath = path.join(tempDir, "args.json");
    const modulePath = path.join(tempDir, "gateway-init.mjs");
    await writeFile(
      modulePath,
      `import { writeFile } from "node:fs/promises";
export async function runForgeBadgerCli(args) {
  await writeFile(${JSON.stringify(argsPath)}, JSON.stringify(args), "utf8");
  return 23;
}
`,
      "utf8"
    );

    const code = await runInit(["init", "--path", "/tmp/project"], {
      resolvePaths: () => ({
        packageRoot: tempDir,
        gatewayEntry: path.join(tempDir, "gateway.js"),
        gatewayInitEntry: modulePath,
        webServerEntry: path.join(tempDir, "server.js"),
        webPublicDir: path.join(tempDir, "public")
      })
    });

    assert.equal(code, 23);
    assert.deepEqual(JSON.parse(await readFile(argsPath, "utf8")), ["init", "--path", "/tmp/project"]);
  });

  it("rejects gateway init entries outside the installed package root", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "forgebadger-init-command-"));

    await assert.rejects(
      () => runInit(["init"], {
        resolvePaths: () => ({
          packageRoot: path.join(tempDir, "package"),
          gatewayEntry: path.join(tempDir, "package", "gateway.js"),
          gatewayInitEntry: path.join(tempDir, "outside", "init.js"),
          webServerEntry: path.join(tempDir, "package", "server.js"),
          webPublicDir: path.join(tempDir, "package", "public")
        })
      }),
      /outside the installed package/
    );
  });
});
