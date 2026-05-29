# OpenForge v1.5 First-User Trial Operations Design

Date: 2026-05-29
Status: Selected for planning
Scope: post-v1.4 milestone direction and operating design

## Context

v1.4 closed the external evidence milestone truthfully. It did not make live
provider, physical Windows/WSL, Feishu developer-console callback, or completed
first-user feedback claims pass without real artifacts. That leaves OpenForge
in a cautious local-first trial posture: the product has a strong local AI CLI
control-plane wedge, but first-user evidence collection still depends on an
operator running the right trial steps and filing redacted results.

v1.5 therefore focuses on trial operations rather than new runtime capability.
The goal is to turn the existing evidence registry, trial checklist, diagnostics
guide, and feedback template into a single executable operating loop for the
first real users.

## Goal

Make first-user trial execution boring and auditable: an operator can run the
local-first trial, collect redacted evidence, route each caveat to the right
issue/report, and decide whether the result unlocks a gate, stays a caveat, or
becomes a product defect.

## Non-Goals

- No hosted collaboration, cloud workers, billing, telemetry, or marketplace.
- No autonomous remote execution or raw shell control through Copilot or
  Feishu.
- No Codex app-server Web prompt/turn workflow.
- No Feishu free-form approval, Feishu terminal input, or Feishu execution
  authority.
- No reclassification of an external gate to `Pass` without the required
  artifact from `docs/EXTERNAL-EVIDENCE-GATES.md`.

## Approach Options

### Recommended: trial-operations loop

Create a small milestone that packages operator steps, feedback intake, and
gate-routing rules around the existing local-first product. Phase 21 starts by
pinning the evidence contract and building the plan for one real trial packet.

Pros:

- Moves the project toward real user evidence without expanding risk.
- Keeps first-user support, release claims, and external caveats in one loop.
- Fits the current source-of-truth documents and GSD phase structure.

Cons:

- It does not create a flashy new feature.
- It still cannot clear external gates until the real provider, WSL host,
  Feishu console, or user feedback exists.

### Alternative: start remote execution runtime

Implement the SSH/remote architecture package next.

Pros:

- Larger product surface and clearer future enterprise direction.

Cons:

- Changes the threat model before the local-first trial loop is proven.
- Conflicts with the current caveat-first release posture.

### Alternative: expand Copilot autonomy

Add more write tools, terminal supervision, or Codex turn input.

Pros:

- Stronger AI-native demo story.

Cons:

- Directly increases authority and transcript-retention risk.
- Moves away from the already selected local-first control-plane wedge.

## Selected Design

v1.5 is **First-User Trial Operations**. It keeps the product position stable:
OpenForge is a local-first AI CLI control plane with AI-native execution
traceability. The milestone creates the operational bridge from "ready for
cautious trial" to "trial evidence exists and is triaged."

The milestone starts with Phase 21:

- restate the current gate status from v1.4;
- define the minimum first-user trial packet;
- route trial outcomes to the correct artifact destinations;
- keep all external gates caveated or blocked until real evidence exists;
- define the next executable plan without touching Gateway/Web runtime code.

Later v1.5 phases can add small automation around the trial loop only if the
Phase 21 plan shows a specific gap, for example a redacted evidence bundler or
issue-prefill helper. Those additions must remain bounded and must not collect
raw terminal transcripts, provider payloads, Feishu bodies, or secrets.

## Evidence Flow

```text
Operator runs trial checklist
  -> collects bounded environment and outcome fields
  -> maps each result to docs/EXTERNAL-EVIDENCE-GATES.md
  -> attaches or links redacted artifact
  -> files feedback through docs/TRIAL-FEEDBACK.md or issue template
  -> maintainer triages severity, owner, disposition, and follow-up
  -> gate stays Caveat/Blocked or moves to Pass only with required artifact
```

## Success Criteria

1. The active roadmap names v1.5 and Phase 21 as the next milestone direction.
2. Active requirements describe the first-user trial operations loop and its
   non-goals.
3. Phase 21 has an executable plan with exact files, commands, and verification
   steps.
4. v1.4 external gate states are preserved until real artifacts exist.
5. The source-of-truth docs no longer leave the next milestone unselected.
