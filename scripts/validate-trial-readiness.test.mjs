import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateTrialReadiness } from "./validate-trial-readiness.mjs";

describe("validateTrialReadiness", () => {
  it("accepts a ready trial preflight without treating it as gate-clearing evidence", async () => {
    const result = await validateTrialReadiness({
      validateIntake: async () => ({ ok: true, errors: [] }),
      validateIssueRoutes: async () => ({
        ok: true,
        gateClearingEvidence: false,
        checked: [{ number: 5, state: "OPEN" }],
        errors: []
      }),
      validateExternalGates: async () => ({ ok: true, errors: [] })
    });

    assert.equal(result.ok, true);
    assert.equal(result.gateClearingEvidence, false);
    assert.deepEqual(
      result.checks.map((check) => check.id),
      ["trial-intake", "trial-issue-routes", "external-evidence-gates"]
    );
    assert.deepEqual(result.errors, []);
    assert.match(result.nextSteps.join("\n"), /Run the first-user trial/);
    assert.match(result.nextSteps.join("\n"), /trial:feedback-issue-audit/);
  });

  it("fails when any readiness check fails and prefixes the source check", async () => {
    const result = await validateTrialReadiness({
      validateIntake: async () => ({ ok: false, errors: ["missing checklist anchor"] }),
      validateIssueRoutes: async () => ({
        ok: false,
        gateClearingEvidence: false,
        checked: [],
        errors: ["GitHub issue #5 must remain OPEN"]
      }),
      validateExternalGates: async () => ({ ok: true, errors: [] })
    });

    assert.equal(result.ok, false);
    assert.equal(result.gateClearingEvidence, false);
    assert.match(result.errors.join("\n"), /trial-intake: missing checklist anchor/);
    assert.match(result.errors.join("\n"), /trial-issue-routes: GitHub issue #5 must remain OPEN/);
    assert.match(result.nextSteps.join("\n"), /Fix readiness errors/);
  });

  it("forwards the repository option to the live issue route check", async () => {
    let receivedRepository;

    const result = await validateTrialReadiness({
      repository: "Example/Repo",
      validateIntake: async () => ({ ok: true, errors: [] }),
      validateIssueRoutes: async (options) => {
        receivedRepository = options.repository;
        return {
          ok: true,
          gateClearingEvidence: false,
          checked: [],
          errors: []
        };
      },
      validateExternalGates: async () => ({ ok: true, errors: [] })
    });

    assert.equal(result.ok, true);
    assert.equal(receivedRepository, "Example/Repo");
  });

  it("rejects any subcheck that claims to be gate-clearing evidence", async () => {
    const result = await validateTrialReadiness({
      validateIntake: async () => ({ ok: true, errors: [] }),
      validateIssueRoutes: async () => ({
        ok: true,
        gateClearingEvidence: true,
        checked: [],
        errors: []
      }),
      validateExternalGates: async () => ({ ok: true, errors: [] })
    });

    assert.equal(result.ok, false);
    assert.equal(result.gateClearingEvidence, false);
    assert.equal(result.checks.find((check) => check.id === "trial-issue-routes").ok, false);
    assert.match(result.errors.join("\n"), /trial-issue-routes.*must not claim gate-clearing evidence/);
  });

  it("fails when a subcheck returns ok false without detailed errors", async () => {
    const result = await validateTrialReadiness({
      validateIntake: async () => ({ ok: false, errors: [] }),
      validateIssueRoutes: async () => ({
        ok: true,
        gateClearingEvidence: false,
        checked: [],
        errors: []
      }),
      validateExternalGates: async () => ({ ok: true, errors: [] })
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /trial-intake.*failed without details/);
  });
});
