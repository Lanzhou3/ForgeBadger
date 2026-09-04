import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findLegacyBrandViolations, isBrandSurface } from "./validate-forgebadger-brand.mjs";

describe("ForgeBadger brand validator", () => {
  it("rejects retired runtime compatibility while allowing bounded security redaction", () => {
    const violations = findLegacyBrandViolations([
      { path: "packages/gateway/src/server.ts", content: "OpenForge Gateway" },
      { path: "packages/gateway/src/services/session-manager.ts", content: "const prefix = 'of-runtime-';" },
      {
        path: "packages/gateway/src/services/redaction.ts",
        content: "const secret = /(?:FORGEBADGER|OPENFORGE)_TOKEN/;"
      }
    ]);

    assert.deepEqual(violations, [
      "packages/gateway/src/server.ts:1: OpenForge Gateway",
      "packages/gateway/src/services/session-manager.ts:1: const prefix = 'of-runtime-';"
    ]);
  });

  it("keeps security exceptions exact instead of allowing runtime aliases", () => {
    const violations = findLegacyBrandViolations([
      { path: "packages/gateway/src/config/env.ts", content: "const bad = input.OPENFORGE_STATE_DIR;" },
      { path: "packages/gateway/src/services/redaction.ts", content: "const ok = /(?:FORGEBADGER|OPENFORGE)_TOKEN/;\nconst bad = input.OPENFORGE_STATE_DIR;" },
      { path: "docs/TRIAL-RUNBOOK.md", content: "OpenForge product" }
    ]);

    assert.deepEqual(violations, [
      "packages/gateway/src/config/env.ts:1: const bad = input.OPENFORGE_STATE_DIR;",
      "packages/gateway/src/services/redaction.ts:2: const bad = input.OPENFORGE_STATE_DIR;",
      "docs/TRIAL-RUNBOOK.md:1: OpenForge product"
    ]);
  });

  it("allows historical evidence only at its exact path", () => {
    const violations = findLegacyBrandViolations([
      {
        path: "packages/gateway/src/services/unapproved-model-binding.ts",
        content: "const stateDir = process.env.OPENFORGE_STATE_DIR;"
      },
      {
        path: "openspec/changes/unapproved/gate-3-acceptance.md",
        content: "Historical database: /Users/lanzhou/.openforge/openforge.db"
      }
    ]);

    assert.deepEqual(violations, [
      "packages/gateway/src/services/unapproved-model-binding.ts:1: const stateDir = process.env.OPENFORGE_STATE_DIR;",
      "openspec/changes/unapproved/gate-3-acceptance.md:1: Historical database: /Users/lanzhou/.openforge/openforge.db"
    ]);
  });

  it("covers active web, documentation, and issue surfaces, but not local planning material", () => {
    assert.equal(isBrandSurface("packages/web/src/lib/auth.ts"), true);
    assert.equal(isBrandSurface("README.md"), true);
    assert.equal(isBrandSurface("docs/TRIAL-RUNBOOK.md"), true);
    assert.equal(isBrandSurface(".github/ISSUE_TEMPLATE/bug_report.yml"), true);
    assert.equal(isBrandSurface("packages/gateway/src/db/migrations/0040_unify_models.sql"), false);
    // OpenSpec changes and the dead templates/ pack are local-only now (untracked).
    assert.equal(isBrandSurface("templates/claude-code-best-practice/README.md"), false);
    assert.equal(isBrandSurface("openspec/changes/replace-copilot-with-portfolio-operations/design.md"), false);
  });
});
