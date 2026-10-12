import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import { UserRepository } from "../../src/db/repositories/user-repository.js";
import type { GitHubRequestOptions } from "../../src/services/github-skill-source.js";

export function skillFixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(drizzle(db), {
    migrationsFolder: fileURLToPath(
      new URL("../../src/db/migrations", import.meta.url),
    ),
  });
  const users = new UserRepository(db);
  const owner = users.create("skill-owner@example.com", "unused");
  const other = users.create("skill-other@example.com", "unused");
  let revision = 1;
  const requests: string[] = [];
  const files: Record<string, string> = {
    "skills/review/SKILL.md":
      "---\nname: review\ndescription: Review changes\n---\n# Review\n",
    "skills/review/references/rules.md": "first rules",
    "skills/review/scripts/check.sh": "echo checked\n",
  };
  const options: GitHubRequestOptions = {
    resolveHost: async () => [{ address: "8.8.8.8", family: 4 }],
    fetcher: async (url) => {
      requests.push(url);
      const parsed = new URL(url);
      if (parsed.hostname === "api.github.com") {
        if (parsed.pathname.includes("/commits/"))
          return new Response(String(revision).repeat(40));
        if (parsed.pathname.includes("/git/trees/")) {
          const selector = decodeURIComponent(
            parsed.pathname.split("/trees/")[1]!,
          );
          const dir = selector.split(":")[1];
          return Response.json({
            truncated: false,
            tree: Object.keys(files)
              .filter((path) => !dir || path.startsWith(`${dir}/`))
              .map((path) => ({
                path: dir ? path.slice(dir.length + 1) : path,
                type: "blob",
                mode: "100644",
                size: Buffer.byteLength(files[path]!),
              })),
          });
        }
        return Response.json({ default_branch: "main" });
      }
      const path = parsed.pathname.split("/").slice(4).join("/");
      return path in files
        ? new Response(files[path])
        : new Response("Not found", { status: 404 });
    },
  };
  return {
    db,
    users,
    owner,
    other,
    options,
    files,
    requests,
    bump: () => {
      revision++;
    },
  };
}
