import { fetchJson } from "@/lib/api";

export type WorkspaceRole = "owner" | "admin" | "developer" | "reviewer" | "viewer";
export type MemberRole = Exclude<WorkspaceRole, "owner" | "admin">;
export interface WorkspaceProject {
  id: string;
  name: string;
  description?: string;
  role: WorkspaceRole;
  capabilities?: string[];
  memberCount: number;
  teamId?:string|null;
  logicalOwnerId?:string;
}
export interface VerificationPolicy {
  command: string;
  args: string[];
  timeoutSeconds: number;
}
export interface WorkspaceMember {
  userId: string;
  email: string;
  displayName?: string;
  role: WorkspaceRole;
  capabilities?: string[];
  state: string;
  revision: number;
}
export interface WorkspaceTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  acceptanceCriteria: string[];
  revision: number;
  assigneeId: string | null;
  reviewerId: string | null;
}
export interface WorkspaceEvent {
  id: string;
  actorId: string;
  actorLabel: string;
  kind: string;
  body: string | Record<string, unknown>;
  createdAt: number;
}
export interface WorkspaceDetail {
  project: WorkspaceProject & {
    revision: number;
    verificationRevision: number;
    executionEnabled: boolean;
    managedExecution?: { supported: boolean; reason: string | null };
    verification: VerificationPolicy | null;
  };
  members: WorkspaceMember[];
  tasks: WorkspaceTask[];
  events: WorkspaceEvent[];
}
export interface WorkspaceRun {
  operation?: {
    kind: "verify" | "review" | "integrate" | "pull_request";
    phase: "active" | "applying" | "interrupted";
  } | null;
  id: string;
  taskId: string;
  actorId: string;
  actorLabel: string;
  state:
    | "provisioning"
    | "ready"
    | "failed"
    | "revoking"
    | "closed"
    | "integrated";
  branch: string;
  baseCommit: string;
  sessionId: string | null;
  previewUrl: string | null;
  prUrl: string | null;
  error: string | null;
  createdAt: number;
}
export interface VerificationReceipt {
  id: string;
  taskRevision: number;
  policyRevision: number;
  current: boolean;
  commit: string;
  status: "running" | "passed" | "failed" | "unknown";
  command: string;
  args: string[];
  exitCode: number | null;
  summary: string;
  createdAt: number;
  finishedAt: number | null;
}
export interface WorkspaceReview {
  id: string;
  actorId: string;
  actorLabel: string;
  commit: string;
  verificationId: string;
  decision: "accepted" | "changes_requested";
  note: string;
  createdAt: number;
}
export interface RunDetail {
  run: WorkspaceRun;
  git: {
    commit: string;
    dirty: boolean;
    error?: string;
    conflicts?:string[];
    files: { path: string; status: string }[];
  };
  verifications: VerificationReceipt[];
  reviews: WorkspaceReview[];
}
export interface TaskDetail {
  task: WorkspaceTask;
  comments: {
    id: string;
    actorId: string;
    actorLabel: string;
    text: string;
    createdAt: number;
  }[];
  runs: WorkspaceRun[];
}
export interface TaskInput {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  assigneeId: string | null;
  reviewerId: string | null;
}
export type AiTool = "claude" | "opencode" | "codex" | "kimi";
const root = "/api/v1/collaboration/projects";
const projectPath = (id: string) => `${root}/${encodeURIComponent(id)}`;
const taskPath = (p: string, t: string) =>
  `${projectPath(p)}/tasks/${encodeURIComponent(t)}`;
const runPath = (p: string, r: string) =>
  `${projectPath(p)}/runs/${encodeURIComponent(r)}`;
const body = (method: string, payload: unknown) => ({
  method,
  body: JSON.stringify(payload),
});
export const collaborationApi = {
  projects: () => fetchJson<{ projects: WorkspaceProject[] }>(root),
  project: (id: string) => fetchJson<WorkspaceDetail>(projectPath(id)),
  archive: (id: string) =>
    fetchJson<{ archived: boolean }>(
      projectPath(id) + "/archive",
      body("POST", {}),
    ),
  member: (id: string, email: string, role: MemberRole) =>
    fetchJson(projectPath(id) + "/members", body("PUT", { email, role })),
  revoke: (id: string, userId: string) =>
    fetchJson<{ revoked: boolean; pendingStops: number }>(
      projectPath(id) + "/members/" + encodeURIComponent(userId),
      { method: "DELETE" },
    ),
  createTask: (p: string, input: TaskInput) =>
    fetchJson<{ task: WorkspaceTask }>(
      projectPath(p) + "/tasks",
      body("POST", input),
    ),
  updateTask: (
    p: string,
    t: string,
    input: TaskInput & { expectedRevision: number },
  ) => fetchJson<{ task: WorkspaceTask }>(taskPath(p, t), body("PATCH", input)),
  task: (p: string, t: string) => fetchJson<TaskDetail>(taskPath(p, t)),
  comment: (p: string, t: string, text: string) =>
    fetchJson(taskPath(p, t) + "/comments", body("POST", { text })),
  prepare: (p: string, t: string, aiTool: AiTool, idempotencyKey: string) =>
    fetchJson<{ run: WorkspaceRun }>(
      taskPath(p, t) + "/runs",
      body("POST", { aiTool, idempotencyKey }),
    ),
  run: (p: string, r: string) => fetchJson<RunDetail>(runPath(p, r)),
  diff: (p: string, r: string, path: string) =>
    fetchJson<{ diff: string }>(
      runPath(p, r) + "/diff?" + new URLSearchParams({ path }),
    ),
  links: (
    p: string,
    r: string,
    previewUrl: string | null,
    prUrl: string | null,
  ) =>
    fetchJson<{ run: WorkspaceRun }>(
      runPath(p, r) + "/links",
      body("PATCH", { previewUrl, prUrl }),
    ),
  review: (
    p: string,
    r: string,
    input: {
      expectedCommit: string;
      verificationId: string;
      decision: WorkspaceReview["decision"];
      note: string;
    },
  ) => fetchJson(runPath(p, r) + "/review", body("POST", input)),
  integrate: (p: string, r: string, expectedCommit: string) =>
    fetchJson(runPath(p, r) + "/integrate", body("POST", { expectedCommit })),
  recover: (p: string, r: string, idempotencyKey: string) =>
    fetchJson<{ run: WorkspaceRun }>(
      runPath(p, r) + "/recover",
      body("POST", { idempotencyKey }),
    ),
  reconcile:(p:string,r:string,expectedCommit:string,idempotencyKey:string)=>fetchJson<{run:WorkspaceRun}>(runPath(p,r)+"/reconcile",body("POST",{expectedCommit,idempotencyKey})),
  pullRequest:(p:string,r:string,input:DraftPullRequestInput)=>fetchJson<{pullRequest:{url:string;number:number;commit:string;draft:boolean};run:WorkspaceRun}>(runPath(p,r)+"/pull-request",body("POST",input)),
  close: (p: string, r: string) =>
    fetchJson(runPath(p, r) + "/close", body("POST", {})),
  handoff: (p: string, r: string) =>
    fetchJson<{ markdown: string }>(runPath(p, r) + "/handoff"),
};

export function safeWorkspaceUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
type Authority = WorkspaceRole | {role:WorkspaceRole;capabilities?:string[]};
export function hasCapability(project:Authority, capability:string):boolean {
 if(typeof project!=='string'&&project.capabilities) return project.capabilities.includes(capability);
 const role=typeof project==='string'?project:project.role;
 const legacy:Record<WorkspaceRole,string[]>={owner:['read','comment','develop','review','manage','closeOwnRun'],developer:['read','comment','develop','closeOwnRun'],reviewer:['read','comment','review'],viewer:['read'],admin:['read','manage']};
 return legacy[role]?.includes(capability)??false;
}
export function canDevelop(project:Authority) {return hasCapability(project,'develop');}
export function canReview(project:Authority,actorId:string|undefined,runActorId:string,team:boolean){return Boolean(actorId)&&hasCapability(project,'review')&&(!team||actorId!==runActorId);}

export interface DraftPullRequestInput {expectedCommit:string;verificationId:string;repository:string;headBranch:string;baseBranch:string;title:string;body:string;token:string}
export function secureCredentialTransport(endpoint:string,page:string):boolean {
 const secure=(value:string)=>{try{const url=new URL(value);return !url.username&&!url.password&&(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)));}catch{return false;}};
 return secure(endpoint)&&secure(page);
}
