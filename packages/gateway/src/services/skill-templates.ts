export interface SkillTemplate {
  id: "plan" | "review" | "verify" | "debug" | "release";
  name: string;
  title: string;
  description: string;
  source: "local";
  version: string;
  content: string;
}

const skillTemplates: SkillTemplate[] = [
  {
    id: "plan",
    name: "plan-workflow",
    title: "Plan Workflow",
    description: "Turn requirements, docs, and code context into a scoped implementation plan.",
    source: "local",
    version: "1.0.0",
    content: skillContent(
      "plan-workflow",
      "Create scoped implementation plans from project context.",
      [
        "Use this Skill when a change needs task decomposition before coding.",
        "",
        "## Workflow",
        "",
        "1. Read the relevant product, architecture, and test documents.",
        "2. Inspect the smallest useful set of source files.",
        "3. List assumptions, risks, dependencies, and acceptance criteria.",
        "4. Break the work into ordered tasks with verification commands.",
        "5. Stop and ask when the scope or ownership boundary is unclear."
      ]
    )
  },
  {
    id: "review",
    name: "review-workflow",
    title: "Review Workflow",
    description: "Review code changes for bugs, regressions, security risks, and missing tests.",
    source: "local",
    version: "1.0.0",
    content: skillContent(
      "review-workflow",
      "Review code changes with evidence and severity ordering.",
      [
        "Use this Skill when reviewing a branch, patch, or pull request.",
        "",
        "## Workflow",
        "",
        "1. Inspect the diff and relevant surrounding code.",
        "2. Prioritize behavioral bugs, security issues, data loss, and missing coverage.",
        "3. Reference concrete files and lines for each finding.",
        "4. Keep summaries brief and place them after findings.",
        "5. State residual test gaps when no blocking issues are found."
      ]
    )
  },
  {
    id: "verify",
    name: "verify-workflow",
    title: "Verify Workflow",
    description: "Run focused verification before claiming a change is complete.",
    source: "local",
    version: "1.0.0",
    content: skillContent(
      "verify-workflow",
      "Verify implementation evidence before handoff.",
      [
        "Use this Skill before marking work complete, merging, or handing off.",
        "",
        "## Workflow",
        "",
        "1. Map the requested behavior to concrete files and tests.",
        "2. Run the narrowest useful test command first.",
        "3. Run typecheck, lint, build, or broader tests when the change crosses modules.",
        "4. Run `git diff --check` before commit or handoff.",
        "5. Report exact commands and any skipped verification with reasons."
      ]
    )
  },
  {
    id: "debug",
    name: "debug-workflow",
    title: "Debug Workflow",
    description: "Reproduce and isolate bugs before applying a minimal fix.",
    source: "local",
    version: "1.0.0",
    content: skillContent(
      "debug-workflow",
      "Debug failures systematically before changing production code.",
      [
        "Use this Skill when a command, feature, integration, or user flow behaves unexpectedly.",
        "",
        "## Workflow",
        "",
        "1. Capture the exact symptom, command, request, or UI action.",
        "2. Reproduce the failure consistently or gather enough evidence to narrow it.",
        "3. Compare with the nearest working path in the same codebase.",
        "4. Form one root-cause hypothesis and test it with a focused failing test.",
        "5. Apply the smallest fix that addresses the root cause and rerun verification."
      ]
    )
  },
  {
    id: "release",
    name: "release-workflow",
    title: "Release Workflow",
    description: "Prepare a small release or milestone handoff with evidence and rollback notes.",
    source: "local",
    version: "1.0.0",
    content: skillContent(
      "release-workflow",
      "Prepare release notes and handoff evidence for completed work.",
      [
        "Use this Skill when closing a milestone, shipping a release, or handing work to another operator.",
        "",
        "## Workflow",
        "",
        "1. Summarize shipped behavior and user-visible changes.",
        "2. List migrations, configuration changes, and operational requirements.",
        "3. Include verification evidence and known residual risks.",
        "4. Document rollback or disablement steps when the change affects runtime behavior.",
        "5. Update changelog, phase docs, or acceptance reports as appropriate."
      ]
    )
  }
];

export function listSkillTemplates(): SkillTemplate[] {
  return skillTemplates.map((template) => ({ ...template }));
}

function skillContent(name: string, description: string, body: string[]): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "version: 1.0.0",
    "---",
    "",
    `# ${name}`,
    "",
    ...body
  ].join("\n");
}
