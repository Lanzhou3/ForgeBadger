# Phase 21 Context: First-User Trial Operations

Date: 2026-05-29

## Why This Phase Exists

v1.4 produced a truthful external evidence closeout, but it intentionally left
the real-world gates unresolved when the required artifacts were missing:

- `LIVE-PROVIDER`: `Caveat`
- `WINDOWS-WSL`: `Caveat`
- `FEISHU-CALLBACK`: `Blocked`
- `FIRST-USER-FEEDBACK`: `Caveat`

Phase 21 starts v1.5 by turning those caveats into an operator-ready trial
operations loop. The phase does not clear the gates by itself. It selects the
next milestone, defines the first-user trial packet, and pins the routing rules
that keep release claims honest.

## Source Evidence

- `docs/reports/v1.4-external-evidence-closeout-2026-05-29.md` is the latest
  closeout matrix.
- `docs/EXTERNAL-EVIDENCE-GATES.md` is the canonical gate registry.
- `docs/TRIAL-CHECKLIST.md` defines the user-facing trial path.
- `docs/TRIAL-FEEDBACK.md` and
  `.github/ISSUE_TEMPLATE/openforge-trial-feedback.yml` define feedback intake.
- `docs/SUPPORT-DIAGNOSTICS.md` defines safe support handoff boundaries.
- `docs/OPEN-SOURCE-READINESS.md` carries public caveat wording.
- Before Phase 21, `MEMORY.md` said the next work was selecting a milestone or
  collecting one remaining external evidence packet. Phase 21 selects that
  milestone and updates the root memory accordingly.

## Product Boundary

Phase 21 keeps the current product wedge:

- local-first AI CLI session control and recovery;
- tmux-backed browser terminal;
- provider/model setup clarity;
- Copilot and Feishu as approval-gated, redacted, tenant-scoped assistance;
- project-manager state as execution traceability.

It does not add remote execution runtime, hosted collaboration, autonomous
terminal control, Codex app-server turn input, or Feishu execution authority.

## Expected Outcomes

Accept only:

- v1.5 selected as the next milestone;
- Phase 21 plan created with exact trial-operations deliverables;
- active requirements updated from v1.4 closeout to v1.5 first-user trial
  operations;
- all v1.4 gate states preserved unless real artifacts are attached.

Reject:

- any `Pass` reclassification without the registry-required artifact;
- broad feature expansion before the first-user operating loop is explicit;
- docs that ask users to paste raw terminal output, provider payloads, Feishu
  bodies, secrets, or local databases.
