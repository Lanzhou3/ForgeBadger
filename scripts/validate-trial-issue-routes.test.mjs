import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_REPOSITORY,
  EXPECTED_TRIAL_ISSUE_ROUTES,
  validateTrialIssueRoutes
} from "./validate-trial-issue-routes.mjs";

describe("validateTrialIssueRoutes", () => {
  it("uses the ForgeBadger GitHub remote as the default repository", () => {
    assert.equal(DEFAULT_REPOSITORY, "Lanzhou3/ForgeBadger");
  });
  it("accepts open trial route issues with expected titles and labels", async () => {
    const result = await validateTrialIssueRoutes({
      fetchIssue: async (route) => buildIssue(route)
    });

    assert.deepEqual(result, {
      ok: true,
      gateClearingEvidence: false,
      checked: EXPECTED_TRIAL_ISSUE_ROUTES.map((route) => ({
        number: route.number,
        gate: route.gate,
        title: route.title,
        state: "OPEN",
        url: `https://example.test/issues/${route.number}`
      })),
      errors: []
    });
  });

  it("rejects missing, closed, mistitled, or mislabeled route issues", async () => {
    const result = await validateTrialIssueRoutes({
      fetchIssue: async (route) => {
        if (route.number === 3) return undefined;
        if (route.number === 4) return buildIssue(route, { state: "CLOSED" });
        return buildIssue(route, {
          title: "Collect unrelated feedback",
          labels: ["product-hardening"]
        });
      }
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /issue #3.*could not be read/);
    assert.match(result.errors.join("\n"), /issue #4.*OPEN/);
    assert.match(result.errors.join("\n"), /issue #5.*title/);
    assert.match(result.errors.join("\n"), /issue #5.*trial-feedback/);
  });

  it("rejects a route issue response with the wrong issue number", async () => {
    const result = await validateTrialIssueRoutes({
      fetchIssue: async (route) => buildIssue(route, { number: route.number + 100 })
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /issue #3.*unexpected number: 103/);
    assert.match(result.errors.join("\n"), /issue #4.*unexpected number: 104/);
    assert.match(result.errors.join("\n"), /issue #5.*unexpected number: 105/);
  });

  it("does not treat issue route validation as gate-clearing evidence", async () => {
    const result = await validateTrialIssueRoutes({
      fetchIssue: async (route) => buildIssue(route)
    });

    assert.equal(result.gateClearingEvidence, false);
  });
});

function buildIssue(route, overrides = {}) {
  return {
    number: route.number,
    title: route.title,
    state: "OPEN",
    labels: route.labels.map((name) => ({ name })),
    url: `https://example.test/issues/${route.number}`,
    ...overrides
  };
}
