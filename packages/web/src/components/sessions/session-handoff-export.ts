import type { ProjectManagerTaskPacket, Session } from "@/lib/api";

export type SessionHandoffAuditIssue =
  | "operator_notes_required"
  | "verification_notes_required"
  | "secret_like_value"
  | "placeholder_text"
  | "raw_terminal_dump";

export interface SessionHandoffExportInput {
  generatedAt: string;
  openReviewItems: string;
  operatorNotes: string;
  session: Session;
  taskPacket: ProjectManagerTaskPacket;
  verificationNotes: string;
}

const secretLikePattern =
  /\b(?:sk-[A-Za-z0-9_-]{6,}|Bearer\s+[A-Za-z0-9._~+/=-]+|OPENFORGE_ATTACH_TOKEN=|api[_-]?key\s*[:=]|token\s*[:=]|password\s*[:=]|secret\s*[:=])/iu;
const placeholderPattern = /\b(?:todo|tbd|fixme|xxx|placeholder)\b/iu;
const rawTerminalDumpPattern = /(?:^|\n)\s*(?:[$#>]\s+\S+|[A-Z0-9_]+=[^\s]+\s+\S+)|\x1b\[[0-9;]*[A-Za-z]/u;

export function auditSessionHandoffExportInput(input: SessionHandoffExportInput): SessionHandoffAuditIssue[] {
  const issues = new Set<SessionHandoffAuditIssue>();
  if (!input.operatorNotes.trim()) issues.add("operator_notes_required");
  if (!input.verificationNotes.trim()) issues.add("verification_notes_required");

  const auditableText = [
    input.taskPacket.title,
    input.taskPacket.prompt,
    ...input.taskPacket.acceptanceCriteria,
    ...input.taskPacket.expectedVerification,
    ...input.taskPacket.evidenceRequirements,
    input.operatorNotes,
    input.verificationNotes,
    input.openReviewItems,
  ].join("\n");
  if (secretLikePattern.test(auditableText)) issues.add("secret_like_value");
  if (placeholderPattern.test(auditableText)) issues.add("placeholder_text");
  if (rawTerminalDumpPattern.test(auditableText)) issues.add("raw_terminal_dump");

  return Array.from(issues);
}

export function buildSessionHandoffMarkdown(input: SessionHandoffExportInput): string {
  const lines = [
    `# Session Handoff: ${input.taskPacket.title}`,
    "",
    "## Metadata",
    `- Generated at: ${input.generatedAt}`,
    `- Project: ${input.taskPacket.projectId}`,
    `- Work item: ${input.taskPacket.workItemId}`,
    `- Session: ${input.session.id}`,
    `- Session status: ${input.session.status}`,
    `- Runtime: ${input.taskPacket.runtime.adapter} / ${input.taskPacket.runtime.templateId}`,
    `- Queue status: ${input.taskPacket.queueStatus}`,
    "",
    "## Task Prompt",
    fenced(input.taskPacket.prompt),
    "",
    "## Acceptance Criteria",
    list(input.taskPacket.acceptanceCriteria),
    "",
    "## Expected Verification",
    list(input.taskPacket.expectedVerification),
    "",
    "## Evidence Requirements",
    list(input.taskPacket.evidenceRequirements),
    "",
    "## Operator Notes",
    input.operatorNotes.trim(),
    "",
    "## Verification Notes",
    input.verificationNotes.trim(),
    "",
    "## Open Review Items",
    input.openReviewItems.trim() || "- None recorded",
    "",
    "## Safety Boundary",
    "- Terminal scrollback remains in tmux and is not stored in SQLite.",
    "- This handoff is manually authored and does not clear external evidence gates.",
    "- Do not paste secrets, raw provider payloads, Feishu message bodies, or raw terminal dumps.",
    ""
  ];
  return lines.join("\n");
}

export function sessionHandoffMarkdownFilename(input: Pick<SessionHandoffExportInput, "generatedAt" | "taskPacket">): string {
  const timestamp = input.generatedAt.replace(/[:.]/g, "-");
  const slug = input.taskPacket.title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "task";
  return `openforge-session-handoff-${slug}-${timestamp}.md`;
}

function fenced(value: string): string {
  const longestBacktickRun = Math.max(
    0,
    ...Array.from(value.matchAll(/`+/gu), (match) => match[0].length),
  );
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return [`${fence}text`, value.trim(), fence].join("\n");
}

function list(values: string[]): string {
  if (values.length === 0) return "- None recorded";
  return values.map((value) => `- ${value}`).join("\n");
}
