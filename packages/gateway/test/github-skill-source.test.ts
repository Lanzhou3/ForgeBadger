import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeContentHash,
  fetchSkillFile,
  listSkillFiles,
  parseGitHubSkillLocator,
  parseSkillMarkdownFrontmatter,
  parseSkillRemoteProvenance,
  resolveGitHubRef,
  serializeSkillRemoteProvenance,
  type GitHubFetchResponse,
  type GitHubFetcher
} from "../src/services/github-skill-source.js";

// 8.8.8.8 is public, so the outbound host blocklist accepts it. Production
// traffic resolves through real DNS; tests must never hit the network.
function allowTestResolver() {
  return async () => [{ address: "8.8.8.8", family: 4 }];
}

function privateIpResolver() {
  return async () => [{ address: "127.0.0.1", family: 4 }];
}

function jsonResponse(value: unknown, status = 200): GitHubFetchResponse {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    arrayBuffer: async () => bytes.buffer as ArrayBuffer
  };
}

function textResponse(body: string, status = 200, headers?: Record<string, string>): GitHubFetchResponse {
  const bytes = new TextEncoder().encode(body);
  const headerMap = new Map(Object.entries(headers ?? {}));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headerMap.get(name.toLowerCase()) ?? null },
    arrayBuffer: async () => bytes.buffer as ArrayBuffer
  };
}

function recordingFetcher(handler: (url: string) => GitHubFetchResponse) {
  const urls: string[] = [];
  const fetcher: GitHubFetcher = async (url) => {
    urls.push(url);
    return handler(url);
  };
  return { fetcher, urls };
}

describe("parseGitHubSkillLocator", () => {
  it("accepts owner/repo shorthand", () => {
    assert.deepEqual(parseGitHubSkillLocator("octo/hello"), { owner: "octo", repo: "hello" });
  });

  it("accepts owner/repo with a subdirectory", () => {
    assert.deepEqual(parseGitHubSkillLocator("octo/hello/skills/pdf"), {
      owner: "octo",
      repo: "hello",
      subpath: "skills/pdf"
    });
  });

  it("accepts https github.com repo URLs", () => {
    assert.deepEqual(parseGitHubSkillLocator("https://github.com/octo/hello"), {
      owner: "octo",
      repo: "hello"
    });
  });

  it("accepts tree URLs and extracts ref plus subpath", () => {
    assert.deepEqual(parseGitHubSkillLocator("https://github.com/octo/hello/tree/main/skills/pdf"), {
      owner: "octo",
      repo: "hello",
      ref: "main",
      subpath: "skills/pdf"
    });
  });

  it("rejects non-github hosts", () => {
    assert.throws(() => parseGitHubSkillLocator("https://example.com/octo/hello"), /github\.com/);
  });

  it("rejects plaintext http", () => {
    assert.throws(() => parseGitHubSkillLocator("http://github.com/octo/hello"), /HTTPS/);
  });

  it("rejects path traversal", () => {
    assert.throws(() => parseGitHubSkillLocator("octo/hello/../secret"), /invalid/i);
  });

  it("rejects repo-less input", () => {
    assert.throws(() => parseGitHubSkillLocator("octo"), /owner\/repo/);
  });
});

describe("resolveGitHubRef", () => {
  it("resolves the default branch through the repo API", async () => {
    const { fetcher, urls } = recordingFetcher((url) => {
      if (url === "https://api.github.com/repos/octo/hello") {
        return jsonResponse({ default_branch: "trunk" });
      }
      if (url === "https://api.github.com/repos/octo/hello/commits/trunk") {
        return jsonResponse({ sha: "abc123def456" });
      }
      return jsonResponse({}, 404);
    });
    const resolved = await resolveGitHubRef({ owner: "octo", repo: "hello", fetcher, resolveHost: allowTestResolver() });
    assert.equal(resolved.sha, "abc123def456");
    assert.equal(resolved.ref, "trunk");
    assert.equal(urls.length, 2);
  });

  it("resolves explicit refs with a single commits call", async () => {
    const { fetcher, urls } = recordingFetcher((url) => {
      if (url === "https://api.github.com/repos/octo/hello/commits/dev") {
        return jsonResponse({ sha: "fedcba987654" });
      }
      return jsonResponse({}, 404);
    });
    const resolved = await resolveGitHubRef({ owner: "octo", repo: "hello", ref: "dev", fetcher, resolveHost: allowTestResolver() });
    assert.equal(resolved.sha, "fedcba987654");
    assert.equal(resolved.ref, "dev");
    assert.deepEqual(urls, ["https://api.github.com/repos/octo/hello/commits/dev"]);
  });
});

describe("listSkillFiles", () => {
  const tree = {
    tree: [
      { path: "SKILL.md", type: "blob" },
      { path: "skills/pdf/SKILL.md", type: "blob" },
      { path: "scripts/run.sh", type: "blob" },
      { path: "docs/readme.md", type: "blob" },
      { path: "deep/nested/SKILL.md", type: "blob" }
    ],
    truncated: false
  };

  function treeFetcher() {
    return recordingFetcher((url) => {
      if (url.startsWith("https://api.github.com/repos/octo/hello/git/trees/")) {
        return jsonResponse(tree);
      }
      return jsonResponse({}, 404);
    });
  }

  it("discovers SKILL.md files under ecosystem convention directories", async () => {
    const { fetcher } = treeFetcher();
    const result = await listSkillFiles({ owner: "octo", repo: "hello", sha: "sha1", fetcher, resolveHost: allowTestResolver() });
    assert.deepEqual(
      result.files.map((file) => file.path),
      ["SKILL.md", "skills/pdf/SKILL.md"]
    );
    assert.equal(result.files[1]?.name, "pdf");
  });

  it("restricts discovery to the requested subpath", async () => {
    const { fetcher } = treeFetcher();
    const result = await listSkillFiles({
      owner: "octo",
      repo: "hello",
      sha: "sha1",
      subpath: "skills",
      fetcher,
      resolveHost: allowTestResolver()
    });
    assert.deepEqual(
      result.files.map((file) => file.path),
      ["skills/pdf/SKILL.md"]
    );
  });

  it("accepts a subpath pointing directly at a SKILL.md file", async () => {
    const { fetcher } = treeFetcher();
    const result = await listSkillFiles({
      owner: "octo",
      repo: "hello",
      sha: "sha1",
      subpath: "skills/pdf/SKILL.md",
      fetcher,
      resolveHost: allowTestResolver()
    });
    assert.deepEqual(
      result.files.map((file) => file.path),
      ["skills/pdf/SKILL.md"]
    );
  });

  it("rejects truncated trees", async () => {
    const { fetcher } = recordingFetcher(() => jsonResponse({ tree: [], truncated: true }));
    await assert.rejects(
      () => listSkillFiles({ owner: "octo", repo: "hello", sha: "sha1", fetcher, resolveHost: allowTestResolver() }),
      /1000-entry limit/
    );
  });

  it("rejects trees over 1000 entries", async () => {
    const entries = Array.from({ length: 1001 }, (_, index) => ({ path: `f${index}.txt`, type: "blob" }));
    const { fetcher } = recordingFetcher(() => jsonResponse({ tree: entries, truncated: false }));
    await assert.rejects(
      () => listSkillFiles({ owner: "octo", repo: "hello", sha: "sha1", fetcher, resolveHost: allowTestResolver() }),
      /1000-entry limit/
    );
  });

  it("includes directories referenced by .claude-plugin/marketplace.json", async () => {
    const marketplace = JSON.stringify({
      name: "demo-marketplace",
      owner: { name: "octo" },
      plugins: [
        { name: "pdf", source: "./plugins/pdf" },
        { name: "external", source: { source: "github", repo: "other/tool" } }
      ]
    });
    const withMarketplaceTree = {
      tree: [
        { path: ".claude-plugin/marketplace.json", type: "blob" },
        { path: "plugins/pdf/SKILL.md", type: "blob" },
        { path: "contrib/SKILL.md", type: "blob" }
      ],
      truncated: false
    };
    const { fetcher, urls } = recordingFetcher((url) => {
      if (url.startsWith("https://api.github.com/repos/octo/hello/git/trees/")) {
        return jsonResponse(withMarketplaceTree);
      }
      if (url.startsWith("https://raw.githubusercontent.com/octo/hello/sha1/")) {
        return textResponse(marketplace);
      }
      return jsonResponse({}, 404);
    });
    const result = await listSkillFiles({ owner: "octo", repo: "hello", sha: "sha1", fetcher, resolveHost: allowTestResolver() });
    assert.deepEqual(
      result.files.map((file) => file.path),
      ["plugins/pdf/SKILL.md"]
    );
    assert.ok(urls.some((url) => url.includes("marketplace.json")));
  });

  it("rejects hosts that resolve to private addresses", async () => {
    const { fetcher } = treeFetcher();
    await assert.rejects(
      () => listSkillFiles({ owner: "octo", repo: "hello", sha: "sha1", fetcher, resolveHost: privateIpResolver() }),
      /rejected/
    );
  });
});

describe("fetchSkillFile", () => {
  it("fetches UTF-8 SKILL.md content", async () => {
    const { fetcher } = recordingFetcher(() => textResponse("---\nname: pdf\n---\n# PDF\n"));
    const file = await fetchSkillFile({
      owner: "octo",
      repo: "hello",
      sha: "sha1",
      path: "skills/pdf/SKILL.md",
      fetcher,
      resolveHost: allowTestResolver()
    });
    assert.equal(file.content, "---\nname: pdf\n---\n# PDF\n");
    assert.ok(file.sizeBytes > 0);
  });

  it("reports 404s as not found", async () => {
    const { fetcher } = recordingFetcher(() => jsonResponse({}, 404));
    await assert.rejects(
      () => fetchSkillFile({ owner: "octo", repo: "hello", sha: "sha1", path: "SKILL.md", fetcher, resolveHost: allowTestResolver() }),
      /not found \(404\)/
    );
  });

  it("rejects files over 128 KiB", async () => {
    const { fetcher } = recordingFetcher(() => textResponse("x".repeat(128 * 1024 + 1)));
    await assert.rejects(
      () => fetchSkillFile({ owner: "octo", repo: "hello", sha: "sha1", path: "SKILL.md", fetcher, resolveHost: allowTestResolver() }),
      /exceeds size limit/
    );
  });

  it("rejects non-UTF-8 content", async () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x01]);
    const { fetcher } = recordingFetcher(() => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => bytes.buffer as ArrayBuffer
    }));
    await assert.rejects(
      () => fetchSkillFile({ owner: "octo", repo: "hello", sha: "sha1", path: "SKILL.md", fetcher, resolveHost: allowTestResolver() }),
      /UTF-8/
    );
  });

  it("rejects NUL bytes", async () => {
    const { fetcher } = recordingFetcher(() => textResponse("abc\0def"));
    await assert.rejects(
      () => fetchSkillFile({ owner: "octo", repo: "hello", sha: "sha1", path: "SKILL.md", fetcher, resolveHost: allowTestResolver() }),
      /binary data/
    );
  });

  it("rejects path traversal", async () => {
    const { fetcher } = recordingFetcher(() => textResponse("ok"));
    await assert.rejects(
      () => fetchSkillFile({ owner: "octo", repo: "hello", sha: "sha1", path: "../secret/SKILL.md", fetcher, resolveHost: allowTestResolver() }),
      /invalid/
    );
  });

  it("follows redirects but rejects non-GitHub redirect targets", async () => {
    const { fetcher, urls } = recordingFetcher((url) => {
      if (url.endsWith("/SKILL.md")) {
        return textResponse("---\nname: x\n---\n", 302, { location: "https://evil.example.com/steal" });
      }
      return textResponse("---\nname: x\n---\n");
    });
    await assert.rejects(
      () => fetchSkillFile({ owner: "octo", repo: "hello", sha: "sha1", path: "SKILL.md", fetcher, resolveHost: allowTestResolver() }),
      /Unexpected GitHub host/
    );
    assert.equal(urls.length, 1);
  });
});

describe("content hash and provenance", () => {
  it("computes prefixed sha256 hashes", () => {
    assert.equal(
      computeContentHash("hello"),
      "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });

  it("parses frontmatter fields", () => {
    const frontmatter = parseSkillMarkdownFrontmatter("---\nname: pdf\ndescription: Do PDF\nversion: 2.0.0\n---\n# x\n");
    assert.deepEqual(frontmatter, { name: "pdf", description: "Do PDF", version: "2.0.0" });
  });

  it("round-trips provenance JSON", () => {
    const provenance = {
      kind: "github" as const,
      repo: "octo/hello",
      ref: "main",
      path: "skills/pdf/SKILL.md",
      resolvedCommitSha: "abc123",
      contentHash: "sha256:xyz",
      installedAt: "2026-09-22T00:00:00.000Z",
      lastCheck: { checkedAt: "2026-09-22T01:00:00.000Z", latestCommitSha: "def456", updateAvailable: true }
    };
    assert.deepEqual(parseSkillRemoteProvenance(serializeSkillRemoteProvenance(provenance)), provenance);
  });

  it("returns undefined for malformed provenance", () => {
    assert.equal(parseSkillRemoteProvenance(undefined), undefined);
    assert.equal(parseSkillRemoteProvenance("not json"), undefined);
    assert.equal(parseSkillRemoteProvenance(JSON.stringify({ kind: "github" })), undefined);
  });
});
