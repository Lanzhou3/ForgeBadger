import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { verifyNpmPackage } from "./verify-npm-package.mjs";

describe("verifyNpmPackage", () => {
  it("accepts a complete npm package artifact tree", async () => {
    const root = await createPackageTree();

    const result = await verifyNpmPackage({ cliPackageRoot: root });

    assert.deepEqual(result, { ok: true, errors: [] });
  });

  it("rejects SQLite sidecar files", async () => {
    const root = await createPackageTree();
    await writeFile(path.join(root, "dist", "gateway", "openforge.db-wal"), "");

    const result = await verifyNpmPackage({ cliPackageRoot: root });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /openforge\.db-wal/);
  });

  it("rejects symlinks inside dist", async () => {
    const root = await createPackageTree();
    await symlink(path.join(root, "README.md"), path.join(root, "dist", "gateway", "README-link.md"));

    const result = await verifyNpmPackage({ cliPackageRoot: root });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /README-link\.md/);
  });

  it("rejects symlinks inside package docs", async () => {
    const root = await createPackageTree();
    await symlink(path.join(root, "README.md"), path.join(root, "docs", "linked.md"));

    const result = await verifyNpmPackage({ cliPackageRoot: root });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /docs\/linked\.md/);
  });

  it("rejects missing Next runtime static artifacts", async () => {
    const root = await createPackageTree({ skipStatic: true });

    const result = await verifyNpmPackage({ cliPackageRoot: root });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /\.next\/static/);
  });

  it("rejects missing Next runtime BUILD_ID", async () => {
    const root = await createPackageTree({ skipBuildId: true });

    const result = await verifyNpmPackage({ cliPackageRoot: root });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /\.next\/BUILD_ID/);
  });
});

async function createPackageTree(options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "openforge-npm-verify-"));
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({
      files: ["dist", "README.md", "LICENSE", "docs/README.zh-CN.md", "docs/README.zh-TW.md", "package.json"]
    })}\n`
  );
  await writeFile(path.join(root, "README.md"), "# OpenForge\n");
  await writeFile(path.join(root, "LICENSE"), "MIT\n");
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "docs", "README.zh-CN.md"), "# OpenForge\n");
  await writeFile(path.join(root, "docs", "README.zh-TW.md"), "# OpenForge\n");

  await writeFile(await ensureFile(root, "dist/index.js"), "");
  await writeFile(await ensureFile(root, "dist/gateway/src/index.js"), "");
  await writeFile(await ensureFile(root, "dist/gateway/src/db/migrations/0001.sql"), "");
  await writeFile(await ensureFile(root, "dist/web/standalone/packages/web/server.js"), "");
  if (!options.skipBuildId) {
    await writeFile(await ensureFile(root, "dist/web/standalone/packages/web/.next/BUILD_ID"), "test-build\n");
  }
  if (!options.skipStatic) {
    await writeFile(await ensureFile(root, "dist/web/standalone/packages/web/.next/static/chunks/app.js"), "");
  }
  await writeFile(await ensureFile(root, "dist/web/standalone/packages/web/node_modules/next/package.json"), "{}\n");
  await writeFile(await ensureFile(root, "dist/web/standalone/node_modules/@swc/helpers/package.json"), "{}\n");
  await writeFile(await ensureFile(root, "dist/web/standalone/packages/web/public/openforge-runtime.js"), "");

  return root;
}

async function ensureFile(root, relative) {
  const filePath = path.join(root, relative);
  await mkdir(path.dirname(filePath), { recursive: true });
  return filePath;
}
