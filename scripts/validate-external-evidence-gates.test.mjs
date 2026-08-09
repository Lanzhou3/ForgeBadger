import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EXPECTED_EXTERNAL_GATES,
  validateExternalEvidenceGates
} from "./validate-external-evidence-gates.mjs";

describe("validateExternalEvidenceGates", () => {
  it("accepts the checked-in external evidence gate registry", () => {
    const result = validateExternalEvidenceGates();

    assert.deepEqual(result, { ok: true, errors: [] });
  });

  it("rejects missing required gate rows", () => {
    const firstUserGate = EXPECTED_EXTERNAL_GATES.find((gate) => gate.id === "FIRST-USER-FEEDBACK");
    const registry = buildRegistryFixture().replace(buildGateRow(firstUserGate), "");
    const result = validateExternalEvidenceGates({ registry });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /FIRST-USER-FEEDBACK/);
  });

  it("rejects FEISHU-BOT-WS Pass until a maintainer records acceptance", () => {
    const feishuGate = EXPECTED_EXTERNAL_GATES.find((gate) => gate.id === "FEISHU-BOT-WS");
    const registry = buildRegistryFixture().replace(
      buildGateRow(feishuGate),
      buildGateRow(feishuGate, "Pass")
    );

    const result = validateExternalEvidenceGates({ registry });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /FEISHU-BOT-WS.*Caveat/);
  });

  it("rejects external gate state drift before real artifacts are recorded", () => {
    const registry = buildRegistryFixture().replace(
      "| `FIRST-USER-FEEDBACK` | `Caveat` |",
      "| `FIRST-USER-FEEDBACK` | `Pass` |"
    );
    const result = validateExternalEvidenceGates({ registry });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /FIRST-USER-FEEDBACK.*Caveat/);
  });

  it("rejects unsupported gate states", () => {
    const registry = buildRegistryFixture().replace(
      "| `LIVE-PROVIDER` | `Caveat` |",
      "| `LIVE-PROVIDER` | `Pending` |"
    );
    const result = validateExternalEvidenceGates({ registry });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /unsupported state/);
  });

  it("rejects duplicate required gate rows in the canonical registry table", () => {
    const firstUserGate = EXPECTED_EXTERNAL_GATES.find((gate) => gate.id === "FIRST-USER-FEEDBACK");
    const registry = buildRegistryFixture().replace(
      buildGateRow(firstUserGate),
      `${buildGateRow(firstUserGate)}\n${buildGateRow(firstUserGate)}`
    );
    const result = validateExternalEvidenceGates({ registry });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /duplicate gate row: FIRST-USER-FEEDBACK/);
  });

  it("ignores non-registry tables instead of letting them override canonical rows", () => {
    const registry = `${buildRegistryFixture()}\n## Example\n\n| Gate | Current State | Owner | Clearing Condition | Rerun Path | Target Destination |\n|------|---------------|-------|--------------------|------------|--------------------|\n| \`FIRST-USER-FEEDBACK\` | \`Pass\` | example | example | example | example |\n`;
    const result = validateExternalEvidenceGates({ registry });

    assert.deepEqual(result, { ok: true, errors: [] });
  });

  it("requires the first-user feedback rerun path to include the packet audit helper", () => {
    const registry = buildRegistryFixture().replace(
      "docs/TRIAL-FEEDBACK.md; pnpm trial:feedback-audit",
      "docs/TRIAL-FEEDBACK.md"
    );
    const result = validateExternalEvidenceGates({ registry });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /FIRST-USER-FEEDBACK.*pnpm trial:feedback-audit/);
  });

  it("requires the first-user feedback rerun path to include the issue audit helper", () => {
    const registry = buildRegistryFixture().replace("; pnpm trial:feedback-issue-audit", "");
    const result = validateExternalEvidenceGates({ registry });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /FIRST-USER-FEEDBACK.*pnpm trial:feedback-issue-audit/);
  });

  it("requires the first-user feedback rerun path to include the bulk issue candidate audit helper", () => {
    const registry = buildRegistryFixture().replace("; pnpm trial:feedback-issues-audit", "");
    const result = validateExternalEvidenceGates({ registry });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /FIRST-USER-FEEDBACK.*pnpm trial:feedback-issues-audit/);
  });

  it("requires Feishu evidence to use the bot long-connection gate instead of public callback as the primary gate", () => {
    const feishuGate = EXPECTED_EXTERNAL_GATES.find((gate) => gate.id === "FEISHU-BOT-WS");
    const registry = buildRegistryFixture().replace(
      buildGateRow(feishuGate),
      "| `FEISHU-CALLBACK` | `Blocked` | public HTTPS Gateway route | Feishu developer-console URL verification | public HTTPS routing; Feishu console URL verification | phase-19-feishu-public-callback-evidence |"
    );
    const result = validateExternalEvidenceGates({ registry });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /FEISHU-BOT-WS/);
  });

  it("requires the Feishu bot rerun path to include the authenticated Gateway smoke helper", () => {
    const registry = buildRegistryFixture().replace("; pnpm smoke:feishu-bot-websocket", "");
    const result = validateExternalEvidenceGates({ registry });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /FEISHU-BOT-WS.*pnpm smoke:feishu-bot-websocket/);
  });

  it("requires the Feishu bot rerun path to include the real SDK long-connection smoke helper", () => {
    const registry = buildRegistryFixture().replace("; pnpm smoke:feishu-bot-live -- --require-gate-evidence", "");
    const result = validateExternalEvidenceGates({ registry });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /FEISHU-BOT-WS.*pnpm smoke:feishu-bot-live/);
  });

  it("requires the Feishu bot live smoke rerun path to save a JSON report", () => {
    const registry = buildRegistryFixture().replace(" --output <report.json>", "");
    const result = validateExternalEvidenceGates({ registry });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /FEISHU-BOT-WS.*--output <report\.json>/);
  });

  it("requires the Feishu bot rerun path to include the real SDK report audit helper", () => {
    const registry = buildRegistryFixture().replace("; pnpm evidence:feishu-bot-live-audit -- <report.json>", "");
    const result = validateExternalEvidenceGates({ registry });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /FEISHU-BOT-WS.*pnpm evidence:feishu-bot-live-audit/);
  });

  it("requires the Feishu bot rerun path to include the Markdown evidence report helper", () => {
    const registry = buildRegistryFixture().replace("; pnpm evidence:feishu-bot-live-report -- --report <report.json> --output <report.md>", "");
    const result = validateExternalEvidenceGates({ registry });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /FEISHU-BOT-WS.*pnpm evidence:feishu-bot-live-report/);
  });
});

function buildRegistryFixture() {
  return [
    "# External Evidence Gates",
    "",
    "## Gate Registry",
    "",
    "| Gate | Current State | Owner | Clearing Condition | Rerun Path | Target Destination |",
    "|------|---------------|-------|--------------------|------------|--------------------|",
    ...EXPECTED_EXTERNAL_GATES.map((gate) => buildGateRow(gate)),
    ""
  ].join("\n");
}

function buildGateRow(gate, state = gate.currentState) {
  return `| \`${gate.id}\` | \`${state}\` | ${gate.ownerPhrase} | ${gate.clearingPhrase} | ${gate.rerunPhrases.join("; ")} | ${gate.targetPhrases.join("; ")} |`;
}
