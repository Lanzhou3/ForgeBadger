# Phase 17 Context: External Evidence Registry

Date: 2026-05-29

## Why This Phase Exists

v1.3 closed product traceability, provider setup clarity, and open-source entry
points, but the release posture still has four external evidence rows that
cannot be cleared by repository tests or documentation:

- live Copilot provider pass;
- physical Windows/WSL terminal pass;
- Feishu developer-console callback pass;
- completed first-user feedback.

These gates are intentionally still `Caveat` or `Blocked`. Phase 17 creates a
single evidence registry so future phases cannot accidentally reclassify a gate
without a real artifact.

## Source Evidence

- `docs/OPEN-SOURCE-READINESS.md` lists the required caveats and rerun paths.
- `docs/reports/v1.1-readiness-closeout-2026-05-21.md` records the detailed
  user-visible caveat matrix.
- `docs/reports/phase-16-open-source-readiness-closeout-2026-05-29.md` says the
  open-source packet does not clear those caveats.
- `MEMORY.md` keeps GitHub issue routing for provider, Windows/WSL, and
  first-user feedback evidence.

## Product Boundary

The registry is a release-trust artifact. It does not add hosted collaboration,
cloud workers, autonomous remote execution, Feishu approval authority, or raw
evidence storage.

## Required Gate States

Use only:

- `Pass`: required artifact exists and redaction rules were checked;
- `Caveat`: collection path exists but the artifact is missing, partial, or not
  representative;
- `Blocked`: collection cannot proceed without an external dependency such as
  credentials, a physical host, public HTTPS routing, or a real user packet.

## Phase 17 Output

- `docs/EXTERNAL-EVIDENCE-GATES.md` as the canonical registry.
- Links from trial, support, open-source, and planning docs.
- Phase summary and validation commands proving coverage and no whitespace
  errors.
