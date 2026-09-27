import assert from "node:assert/strict";
import { test } from "node:test";
import {
  listSkillFiles,
  parseSkillMarkdownFrontmatter,
  resolveGitHubRef,
} from "../src/services/github-skill-source.js";

const resolveHost = async () => [{ address: "8.8.8.8", family: 4 }];

test("GitHub metadata accepts CRLF and YAML folded descriptions", () => {
  const parsed = parseSkillMarkdownFrontmatter(
    '---\r\nname: review\r\ndescription: >-\r\n  Review code\r\n  with care\r\nmetadata:\r\n  version: "2"\r\n---\r\nBody',
  );
  assert.equal(parsed.description, "Review code with care");
  assert.equal(parsed.name, "review");
  assert.equal(parsed.version, "2");
});

test("GitHub ref resolution requests the small SHA representation", async () => {
  const sha = "a".repeat(40);
  const result = await resolveGitHubRef({
    owner: "test",
    repo: "large",
    ref: "main",
    resolveHost,
    fetcher: async (_url, init) => {
      assert.equal(
        new Headers(init?.headers).get("accept"),
        "application/vnd.github.sha",
      );
      return new Response(sha);
    },
  });
  assert.equal(result.sha, sha);
});

test("a selected subtree does not request the entire repository tree", async () => {
  const requests: string[] = [];
  const result = await listSkillFiles({
    owner: "test",
    repo: "large",
    sha: "a".repeat(40),
    subpath: "skills/review",
    resolveHost,
    fetcher: async (url) => {
      requests.push(url);
      const selector = decodeURIComponent(
        new URL(url).pathname.split("/trees/")[1] ?? "",
      );
      assert.ok(
        selector.endsWith(":skills/review"),
        "must request subtree directly",
      );
      return Response.json({
        tree: [{ path: "SKILL.md", type: "blob", mode: "100644" }],
        truncated: false,
      });
    },
  });
  assert.deepEqual(
    result.files.map((file) => file.path),
    ["skills/review/SKILL.md"],
  );
  assert.equal(requests.length, 1);
});

test("GitHub API requests carry the required explicit User-Agent for native HTTPS", async () => {
  await resolveGitHubRef({
    owner: "octo",
    repo: "demo",
    ref: "main",
    resolveHost,
    fetcher: async (_url, init) => {
      assert.equal(new Headers(init?.headers).get("user-agent"), "ForgeBadger");
      return new Response("a".repeat(40));
    },
  });
});
