import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { copyGatewayMigrations } from "./build-gateway-assets.mjs";

describe("Gateway build assets", () => {
  it("copies database migrations without platform shell commands", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-gateway-assets-"));
    const source = path.join(root, "src", "db", "migrations");
    const target = path.join(root, "dist", "src", "db", "migrations");
    await mkdir(path.join(source, "meta"), { recursive: true });
    await writeFile(path.join(source, "0001.sql"), "SELECT 1;\n");
    await writeFile(path.join(source, "meta", "_journal.json"), "{}\n");

    await copyGatewayMigrations({ source, target });

    assert.equal(await readFile(path.join(target, "0001.sql"), "utf8"), "SELECT 1;\n");
    assert.equal(await readFile(path.join(target, "meta", "_journal.json"), "utf8"), "{}\n");
  });
});
