import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSkillInstallContent,
  getSkillSource,
  listSkillSources,
  previewRemoteSkillSource
} from "../src/services/skill-sources.js";

describe("skill source catalog", () => {
  it("lists the supported installation sources", () => {
    const sources = listSkillSources();
    assert.equal(sources.length >= 3, true);
    assert.deepEqual(
      sources.map((source) => source.id),
      ["local", "clawhub", "github"]
    );
  });

  it("builds starter content for an installation source", () => {
    const source = getSkillSource("github");
    assert.ok(source);

    const content = buildSkillInstallContent(source!, {
      name: "review-workflow",
      description: "Review pull requests with a consistent checklist."
    });

    assert.match(content, /name: review-workflow/);
    assert.match(content, /source: github/);
    assert.match(content, /Review pull requests with a consistent checklist\./);
  });

  it("honors custom content during installation", () => {
    const source = getSkillSource("local");
    assert.ok(source);

    const content = buildSkillInstallContent(source!, {
      name: "safe-skill",
      content: "# Safe Skill"
    });

    assert.equal(content, "# Safe Skill");
  });

  it("previews a raw remote SKILL.md with provenance", async () => {
    const preview = await previewRemoteSkillSource({
      sourceId: "github",
      url: "https://raw.githubusercontent.com/acme/review/main/SKILL.md",
      fetcher: async () => response(`---
name: review-workflow
description: Review pull requests consistently.
version: 2.0.0
---

# Review Workflow
`)
    });

    assert.equal(preview.name, "review-workflow");
    assert.equal(preview.description, "Review pull requests consistently.");
    assert.equal(preview.version, "2.0.0");
    assert.equal(preview.provenance.kind, "raw-skill");
    assert.equal(preview.provenance.sourceId, "github");
    assert.match(preview.provenance.url, /raw\.githubusercontent\.com/);
    assert.equal(preview.sizeBytes, Buffer.byteLength(preview.content, "utf8"));
  });

  it("previews a manifest skill by id without executing content", async () => {
    const preview = await previewRemoteSkillSource({
      sourceId: "clawhub",
      url: "https://clawhub.ai/catalog/skills.json",
      skillId: "safe-review",
      fetcher: async () => response(JSON.stringify({
        skills: [
          {
            id: "safe-review",
            name: "safe-review",
            description: "Review with a checklist.",
            version: "1.2.0",
            content: "# Safe Review\n"
          }
        ]
      }))
    });

    assert.equal(preview.name, "safe-review");
    assert.equal(preview.content, "# Safe Review\n");
    assert.equal(preview.provenance.kind, "manifest");
    assert.equal(preview.provenance.skillId, "safe-review");
  });

  it("rejects oversized remote Skill content", async () => {
    await assert.rejects(
      previewRemoteSkillSource({
        sourceId: "github",
        url: "https://raw.githubusercontent.com/acme/large/main/SKILL.md",
        maxBytes: 8,
        fetcher: async () => response("# Too large\n")
      }),
      /size limit/i
    );
  });

  it("rejects invalid remote Skill names", async () => {
    await assert.rejects(
      previewRemoteSkillSource({
        sourceId: "github",
        url: "https://raw.githubusercontent.com/acme/bad/main/SKILL.md",
        fetcher: async () => response(`---
name: ../bad
---

# Bad
`)
      }),
      /invalid skill name/i
    );
  });

  it("times out remote Skill fetches", async () => {
    await assert.rejects(
      previewRemoteSkillSource({
        sourceId: "github",
        url: "https://raw.githubusercontent.com/acme/slow/main/SKILL.md",
        timeoutMs: 5,
        fetcher: (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          })
      }),
      /timed out/i
    );
  });
});

function response(body: string): Pick<Response, "ok" | "status" | "text"> {
  return {
    ok: true,
    status: 200,
    async text() {
      return body;
    }
  };
}
