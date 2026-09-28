export interface StarterTaskPack {
  id: string;
  name: string;
  description: string;
  recommendedAdapter: "claude" | "opencode" | "codex";
  promptFrame: string;
  acceptanceChecklist: string[];
  verificationGuidance: string[];
  evidenceFields: string[];
}

const starterTaskPacks: StarterTaskPack[] = [
  {
    id: "code-review",
    name: "Code Review",
    description: "Review a focused change for correctness, security, regressions, and missing tests.",
    recommendedAdapter: "claude",
    promptFrame: "Review the linked change as a senior engineer. Lead with concrete findings, file paths, severity, and missing verification.",
    acceptanceChecklist: [
      "Findings are ordered by severity with file or route references",
      "Security, tenant isolation, and data leakage risks are checked",
      "Missing or weak tests are called out explicitly"
    ],
    verificationGuidance: [
      "Run the narrow test suite for touched modules",
      "Run typecheck for the touched package",
      "Run git diff --check"
    ],
    evidenceFields: [
      "Reviewed files or diff scope",
      "Test run summary",
      "Open questions or residual risk"
    ]
  },
  {
    id: "bugfix",
    name: "Bugfix",
    description: "Reproduce a defect, patch the root cause, and preserve a regression test.",
    recommendedAdapter: "claude",
    promptFrame: "Reproduce the defect first, identify the root cause, add a failing regression test, then implement the minimal fix.",
    acceptanceChecklist: [
      "The original failure is reproduced before the fix",
      "A regression test fails before implementation and passes after",
      "The fix is scoped to the root cause"
    ],
    verificationGuidance: [
      "Run the new regression test",
      "Run the affected package test command",
      "Run the affected package typecheck"
    ],
    evidenceFields: [
      "Original failure output",
      "Regression test path",
      "Post-fix verification output"
    ]
  },
  {
    id: "docs-sync",
    name: "Docs Sync",
    description: "Update product, API, or runbook docs after behavior changes without changing runtime code.",
    recommendedAdapter: "codex",
    promptFrame: "Synchronize documentation with the current behavior. Keep gate states truthful and avoid claiming unverified external evidence.",
    acceptanceChecklist: [
      "Changed behavior is documented in the source-of-truth doc",
      "Gate caveats remain unchanged unless real evidence exists",
      "Docs avoid credentials, tokens, and raw terminal logs"
    ],
    verificationGuidance: [
      "Run documentation validator commands when present",
      "Run evidence gate validation",
      "Run git diff --check"
    ],
    evidenceFields: [
      "Updated docs",
      "Validator output summary",
      "Gate state note"
    ]
  },
  {
    id: "test-generation",
    name: "Test Generation",
    description: "Add focused tests for an existing behavior or boundary without broad refactors.",
    recommendedAdapter: "claude",
    promptFrame: "Add focused tests that exercise real code paths, boundary cases, and tenant or safety constraints.",
    acceptanceChecklist: [
      "Tests cover one behavior per case",
      "Mocks are used only for external dependencies",
      "Error and boundary paths are represented"
    ],
    verificationGuidance: [
      "Run the new test file",
      "Run the package test command if the touched path is shared",
      "Run typecheck when TypeScript signatures are touched"
    ],
    evidenceFields: [
      "Test file path",
      "Covered behavior list",
      "Verification output summary"
    ]
  },
  {
    id: "release-notes",
    name: "Release Notes",
    description: "Draft bounded release notes from completed changes and known caveats.",
    recommendedAdapter: "codex",
    promptFrame: "Draft release notes from verified changes only. Separate shipped behavior, caveats, verification, and follow-up work.",
    acceptanceChecklist: [
      "Release notes mention only verified changes",
      "Known caveats and external gates stay explicit",
      "No raw logs, credentials, or provider payloads are included"
    ],
    verificationGuidance: [
      "Check linked reports or tests for each shipped claim",
      "Run evidence gate validation",
      "Run markdown or docs checks when present"
    ],
    evidenceFields: [
      "Source changes or reports",
      "Verification commands",
      "Preserved caveats"
    ]
  },
  {
    id: "first-user-evidence",
    name: "First-User Evidence",
    description: "Prepare a first-user trial evidence packet for maintainer triage without clearing gates automatically.",
    recommendedAdapter: "claude",
    promptFrame: "Prepare a redaction-aware first-user evidence packet. Treat passing audits as maintainer-triage readiness, not gate clearance.",
    acceptanceChecklist: [
      "Required first-user packet fields are present",
      "Diagnostics and browser evidence are redacted and bounded",
      "Gate states remain caveated until reviewed real evidence is linked"
    ],
    verificationGuidance: [
      "Run pnpm trial:feedback-audit -- <packet.md>",
      "Run pnpm evidence:gates-validate",
      "Record unresolved caveats"
    ],
    evidenceFields: [
      "Feedback packet path or issue link",
      "Audit output summary",
      "Maintainer triage decision"
    ]
  }
];

export function listStarterTaskPacks(): StarterTaskPack[] {
  return starterTaskPacks.map((pack) => ({ ...pack }));
}

export function getStarterTaskPack(packId: string): StarterTaskPack | undefined {
  return starterTaskPacks.find((pack) => pack.id === packId);
}
