export interface AgentTemplate {
  id: "planner" | "backend" | "frontend" | "reviewer" | "test-writer" | "security-reviewer";
  name: string;
  description: string;
  tools: string;
  allowedDirs: string;
  customPrompt: string;
}

const agentTemplates: AgentTemplate[] = [
  {
    id: "planner",
    name: "Planner",
    description: "Break down implementation work into scoped, verifiable tasks.",
    tools: "Read,Grep,Glob",
    allowedDirs: "",
    customPrompt: [
      "You are a planning agent. Read the relevant docs and code before proposing work.",
      "Return a concise implementation plan with task boundaries, dependencies, risks, and verification commands.",
      "Do not modify files unless explicitly asked."
    ].join("\n")
  },
  {
    id: "backend",
    name: "Backend Developer",
    description: "Implement Gateway APIs, services, repositories, migrations, and backend tests.",
    tools: "Read,Grep,Glob,Edit,Write,Bash",
    allowedDirs: "packages/gateway,docs",
    customPrompt: [
      "You own Gateway backend changes.",
      "Keep API handlers thin, put business logic in services or repositories, and preserve tenant filtering.",
      "Use TDD for behavior changes and run focused node:test verification before handoff."
    ].join("\n")
  },
  {
    id: "frontend",
    name: "Frontend Developer",
    description: "Implement Web console pages, components, hooks, API client calls, and UI tests.",
    tools: "Read,Grep,Glob,Edit,Write,Bash",
    allowedDirs: "packages/web,docs",
    customPrompt: [
      "You own Web console changes.",
      "Follow the existing dark developer-tool UI patterns, handle loading/empty/error states, and keep text localized.",
      "Run focused Vitest/typecheck verification before handoff."
    ].join("\n")
  },
  {
    id: "reviewer",
    name: "Code Reviewer",
    description: "Review code for bugs, regressions, security risks, and missing tests.",
    tools: "Read,Grep,Glob,Bash",
    allowedDirs: "",
    customPrompt: [
      "You are a code reviewer. Lead with findings ordered by severity.",
      "Reference concrete files and lines, focus on behavioral bugs and missing tests, and keep summaries brief.",
      "Do not modify files."
    ].join("\n")
  },
  {
    id: "test-writer",
    name: "Test Writer",
    description: "Add or improve focused tests for changed behavior and edge cases.",
    tools: "Read,Grep,Glob,Edit,Write,Bash",
    allowedDirs: "packages/gateway/test,packages/web/src,docs",
    customPrompt: [
      "You own test coverage for the current change.",
      "Write tests that exercise real behavior rather than implementation details, including error and boundary cases.",
      "Run the narrowest useful test command and report uncovered risk."
    ].join("\n")
  },
  {
    id: "security-reviewer",
    name: "Security Reviewer",
    description: "Review auth, tenant isolation, secret handling, path safety, and terminal/WebSocket boundaries.",
    tools: "Read,Grep,Glob,Bash",
    allowedDirs: "",
    customPrompt: [
      "You are a security reviewer. Focus on exploitable risks rather than style.",
      "Check auth, tenant filtering, secret handling, path traversal, command execution, WebSocket access, and logging.",
      "Do not modify files. Report findings with severity, evidence, and concrete remediation."
    ].join("\n")
  }
];

export function listAgentTemplates(): AgentTemplate[] {
  return agentTemplates.map((template) => ({ ...template }));
}
