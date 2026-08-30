import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findLegacyBrandViolations, isBrandSurface } from "./validate-forgebadger-brand.mjs";

describe("ForgeBadger brand validator", () => {
  it("rejects unapproved legacy branding while allowing bounded compatibility", () => {
    const violations = findLegacyBrandViolations([
      { path: "packages/gateway/src/server.ts", content: "OpenForge Gateway" },
      {
        path: "packages/gateway/src/config/env.ts",
        content: "const legacyName = `OPENFORGE_${suffix}`;"
      }
    ]);

    assert.deepEqual(violations, ["packages/gateway/src/server.ts:1: OpenForge Gateway"]);
  });

  it("keeps compatibility exceptions exact instead of allowing arbitrary legacy names", () => {
    const legacyRepository = ["Lanzhou3", "OpenForge"].join("/");
    const violations = findLegacyBrandViolations([
      { path: "packages/gateway/src/config/env.ts", content: "const ok = input.OPENFORGE_STATE_DIR;\nconst bad = input.OPENFORGE_FUTURE;" },
      { path: "scripts/audit-trial-feedback-issue.mjs", content: `const DEFAULT_REPOSITORY = "${legacyRepository}";\nconst title = "OpenForge feedback";` },
      { path: "docs/TRIAL-RUNBOOK.md", content: `GitHub repo: ${legacyRepository}\nOpenForge product` }
    ]);

    assert.deepEqual(violations, [
      "packages/gateway/src/config/env.ts:2: const bad = input.OPENFORGE_FUTURE;",
      `scripts/audit-trial-feedback-issue.mjs:1: const DEFAULT_REPOSITORY = "${legacyRepository}";`,
      'scripts/audit-trial-feedback-issue.mjs:2: const title = "OpenForge feedback";',
      `docs/TRIAL-RUNBOOK.md:1: GitHub repo: ${legacyRepository}`,
      "docs/TRIAL-RUNBOOK.md:2: OpenForge product"
    ]);
  });

  it("covers active web, documentation, template, issue, and OpenSpec surfaces", () => {
    assert.equal(isBrandSurface("packages/web/src/lib/auth.ts"), true);
    assert.equal(isBrandSurface("README.md"), true);
    assert.equal(isBrandSurface("docs/TRIAL-RUNBOOK.md"), true);
    assert.equal(isBrandSurface("templates/claude-code-best-practice/README.md"), true);
    assert.equal(isBrandSurface(".github/ISSUE_TEMPLATE/bug_report.yml"), true);
    assert.equal(isBrandSurface("openspec/changes/replace-copilot-with-portfolio-operations/design.md"), true);
    assert.equal(isBrandSurface("packages/gateway/src/db/migrations/0040_unify_models.sql"), false);
  });
});
