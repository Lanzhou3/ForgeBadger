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
    await writeFile(path.join(root, "dist", "gateway", "forgebadger.db-wal"), "");

    const result = await verifyNpmPackage({ cliPackageRoot: root });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /forgebadger\.db-wal/);
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

  it("rejects Web framework dependencies that are bundled in the standalone runtime", async () => {
    const root = await createPackageTree({
      packageJson: {
        dependencies: {
          next: "^16.0.0",
          react: "^19.0.0",
          "react-dom": "^19.0.0"
        }
      }
    });

    const result = await verifyNpmPackage({ cliPackageRoot: root });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /forbidden runtime dependency: next/);
    assert.match(result.errors.join("\n"), /forbidden runtime dependency: react/);
    assert.match(result.errors.join("\n"), /forbidden runtime dependency: react-dom/);
  });

  it("rejects Gateway dependencies missing from the published CLI", async () => {
    const root = await createPackageTree({
      packageJson: { dependencies: { express: "^4.0.0" } }
    });
    const gatewayPackageRoot = await mkdtemp(path.join(tmpdir(), "forgebadger-gateway-package-"));
    await writeFile(
      path.join(gatewayPackageRoot, "package.json"),
      `${JSON.stringify({ dependencies: { express: "^4.0.0", "smol-toml": "^1.7.1" } })}\n`
    );

    const result = await verifyNpmPackage({ cliPackageRoot: root, gatewayPackageRoot });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /missing Gateway runtime dependency: smol-toml/);
  });

  it("rejects Gateway runtime dependency version drift", async () => {
    const root = await createPackageTree({
      packageJson: { dependencies: { express: "^4.19.2" } }
    });
    const gatewayPackageRoot = await mkdtemp(path.join(tmpdir(), "forgebadger-gateway-package-"));
    await writeFile(
      path.join(gatewayPackageRoot, "package.json"),
      `${JSON.stringify({ dependencies: { express: "^4.22.0" } })}\n`
    );

    const result = await verifyNpmPackage({ cliPackageRoot: root, gatewayPackageRoot });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /Gateway runtime dependency version mismatch: express/);
  });

  it("rejects platform-native binaries bundled in the Web standalone runtime", async () => {
    const root = await createPackageTree();
    await writeFile(
      await ensureFile(root, "dist/web/standalone/node_modules/@img/sharp-darwin-arm64/lib/sharp.node"),
      "native"
    );

    const result = await verifyNpmPackage({ cliPackageRoot: root });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /sharp\.node/);
  });

  it("rejects relative brand asset URLs in the package README", async () => {
    const root = await createPackageTree();
    await writeFile(
      path.join(root, "README.md"),
      '<img src="packages/web/public/brand/forgebadger-banner.png" alt="ForgeBadger">\n'
    );

    const result = await verifyNpmPackage({ cliPackageRoot: root });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /README\.md uses a relative brand asset URL/);
  });

  it("rejects parent-relative brand asset URLs in translated package READMEs", async () => {
    const root = await createPackageTree();
    await writeFile(
      path.join(root, "docs", "README.zh-CN.md"),
      '<img src="../packages/web/public/brand/forgebadger-banner.png" alt="ForgeBadger">\n'
    );

    const result = await verifyNpmPackage({ cliPackageRoot: root });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /docs\/README\.zh-CN\.md uses a relative brand asset URL/);
  });

  it("accepts raw GitHub brand asset URLs in package READMEs", async () => {
    const root = await createPackageTree();
    const absoluteUrl =
      "https://raw.githubusercontent.com/Lanzhou3/ForgeBadger/main/packages/web/public/brand/forgebadger-banner.png";
    await writeFile(path.join(root, "README.md"), `<img src="${absoluteUrl}" alt="ForgeBadger">\n`);

    const result = await verifyNpmPackage({ cliPackageRoot: root });

    assert.deepEqual(result, { ok: true, errors: [] });
  });
});

async function createPackageTree(options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "forgebadger-npm-verify-"));
  const packageJson = {
    files: ["dist", "README.md", "LICENSE", "docs/README.zh-CN.md", "docs/README.zh-TW.md", "package.json"],
    ...options.packageJson
  };
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify(packageJson)}\n`
  );
  await writeFile(path.join(root, "README.md"), "# ForgeBadger\n");
  await writeFile(path.join(root, "LICENSE"), "MIT\n");
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "docs", "README.zh-CN.md"), "# ForgeBadger\n");
  await writeFile(path.join(root, "docs", "README.zh-TW.md"), "# ForgeBadger\n");

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
  await writeFile(await ensureFile(root, "dist/web/standalone/packages/web/public/forgebadger-runtime.js"), "");

  return root;
}

async function ensureFile(root, relative) {
  const filePath = path.join(root, relative);
  await mkdir(path.dirname(filePath), { recursive: true });
  return filePath;
}
