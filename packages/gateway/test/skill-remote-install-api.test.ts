import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSkillRoutes } from "../src/routes/skills.js";
import { createCatalogRoutes } from "../src/routes/catalog.js";
import { CatalogRepository } from "../src/db/repositories/catalog-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { SkillRepository } from "../src/db/repositories/skill-repository.js";
import { skillFixture } from "./fixtures/skill-registry.js";
import type { SkillInstallPreview } from "../src/services/skill-install-service.js";
const secret = "0123456789abcdef0123456789abcdef";
const f = skillFixture();
const home = mkdtempSync(path.join(tmpdir(), "fb-skill-api-"));
const previousHome = process.env.AGENTS_HOME;
let server: ReturnType<express.Express["listen"]>;
let base = "";
function token(id: string) {
  return jwt.sign({ userId: id, email: "skill@example.com" }, secret);
}
async function request(
  route: string,
  body?: unknown,
  userId = f.owner.id,
  method = body === undefined ? "GET" : "POST",
) {
  const res = await fetch(`${base}/api/v1${route}`, {
    method,
    headers: {
      authorization: `Bearer ${token(userId)}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
}
before(async () => {
  process.env.AGENTS_HOME = home;
  const app = express();
  app.use(express.json());
  app.locals.jwtSecret = secret;
  app.locals.db = f.db;
  app.use("/api/v1", createSkillRoutes(f.db, f.options));
  app.use("/api/v1/catalog", createCatalogRoutes(f.db, f.options));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string")
        base = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  f.db.close();
  rmSync(home, { recursive: true, force: true });
  if (previousHome === undefined) delete process.env.AGENTS_HOME;
  else process.env.AGENTS_HOME = previousHome;
});

test("all legacy remote write entrypoints require a reviewed preview", async () => {
  const repo = new CatalogRepository(f.db, f.owner.id);
  const [item] = repo.replaceItems("legacy", [
    {
      sourceId: "legacy",
      itemType: "skill",
      externalId: "review",
      name: "review",
      metadata: { skillPackage: { name: "review", content: "# Review" } },
    },
  ]);
  for (const [route, body] of [
    [
      "/skills/install",
      {
        sourceId: "github",
        name: "review",
        url: "https://raw.githubusercontent.com/octo/demo/main/SKILL.md",
      },
    ],
    [
      "/skills/install/preview",
      {
        sourceId: "github",
        url: "https://raw.githubusercontent.com/octo/demo/main/SKILL.md",
      },
    ],
    ["/skills/install/github", { repo: "octo/demo", path: "skills/review" }],
    ["/skills/some-id/update", {}],
    [`/catalog/items/${item!.id}/install`, {}],
  ] as const) {
    const result = await request(route, body);
    assert.equal(result.status, 409, JSON.stringify(result));
    assert.equal(result.body.details.reason, "PREVIEW_REQUIRED");
  }
  assert.equal(f.requests.length, 0);
});

test("new API reviews complete resources and installs disabled without a global mirror", async () => {
  const result = await request("/skills/registry/preview", {
    locator: { kind: "github", repo: "octo/demo", path: "skills/review" },
  });
  assert.equal(result.status, 200, JSON.stringify(result));
  const preview = result.body.data as SkillInstallPreview;
  const foreign = await request(
    "/skills/registry/install",
    { token: preview.token, operation: "install" },
    f.other.id,
  );
  assert.equal(foreign.status, 409);
  const installed = await request("/skills/registry/install", {
    token: preview.token,
    operation: "install",
  });
  assert.equal(installed.status, 200, JSON.stringify(installed));
  assert.equal(installed.body.data.skill.isEnabled, false);
  assert.equal(existsSync(path.join(home, "skills", "review")), false);
  const id = installed.body.data.skill.id;
  assert.equal(
    (await request(`/skills/${id}`, undefined, f.other.id)).status,
    404,
  );
  assert.equal(
    (await request(`/skills/${id}/revisions`, undefined, f.other.id)).status,
    404,
  );
  assert.equal(
    (await request(`/skills/${id}/check-update`, {}, f.other.id)).status,
    404,
  );
  assert.equal(
    (
      await request("/skills/registry/install", {
        token: preview.token,
        operation: "install",
      })
    ).status,
    409,
  );
  const check = await request(`/skills/${id}/check-update`, {});
  assert.equal(check.body.data.updateAvailable, false);
  f.files["skills/review/references/rules.md"] = "new rules";
  f.bump();
  const batch = await request("/skills/check-updates", {});
  assert.equal(batch.body.data.results[0].updateAvailable, true);
  const update = await request("/skills/registry/preview", { skillId: id });
  assert.equal(update.body.data.changes[0].path, "references/rules.md");
  const updated = await request("/skills/registry/install", {
    token: update.body.data.token,
    operation: "update",
    skillId: id,
  });
  assert.equal(updated.status, 200);
  const history = await request(`/skills/${id}/revisions`);
  assert.equal(history.body.data.revisions.length, 2);
});

test("deletion retains legacy global copies but list and second-tenant scans never reimport them", async () => {
  const directory = path.join(home, "skills", "legacy-skill");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, "SKILL.md"),
    "---\nname: legacy-skill\ndescription: legacy\n---\nLegacy",
  );
  writeFileSync(path.join(directory, ".forgebadger-managed.json"), "{}");
  const repo = new SkillRepository(f.db, f.owner.id);
  const skill = repo.create({
    name: "legacy-skill",
    content: "legacy",
    source: "github:octo/demo",
    remoteProvenance: '{"kind":"github"}',
  });
  assert.equal(
    (await request(`/skills/${skill.id}`, undefined, f.owner.id, "DELETE"))
      .status,
    200,
  );
  assert.ok(existsSync(directory));
  for (const userId of [f.owner.id, f.other.id]) {
    const listed = await request("/skills", undefined, userId);
    assert.equal(listed.status, 200);
    assert.equal(
      listed.body.data.skills.some(
        (s: { name: string }) => s.name === "legacy-skill",
      ),
      false,
    );
  }
});
