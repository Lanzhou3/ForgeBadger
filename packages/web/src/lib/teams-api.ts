import { fetchJson } from "./api";
import type { User } from "./auth";
export type TeamRole = "owner" | "admin" | "member";
export interface Team {
  id: string;
  name: string;
  role: TeamRole;
  ownerId: string;
  revision: number;
  state: "active" | "closing" | "closed";
  capabilities: {
    manageMembers: boolean;
    manageAdmins: boolean;
    inviteMembers: boolean;
    inviteAdmins: boolean;
    transferOwner: boolean;
    close: boolean;
    enrollOwnProjects: boolean;
  };
}
export interface TeamMember {
  userId: string;
  email: string;
  displayName: string | null;
  role: TeamRole;
  state: "active" | "leaving" | "left";
  revision: number;
}
export interface TeamProject {
  projectId: string;
  name: string;
  logicalOwnerId: string;
  revision: number;
  role: string;
  capabilities: string[];
}
export interface TeamDetail {
  team: Team;
  members: TeamMember[];
  projects: TeamProject[];
}
export interface TeamInvitation {
  id: string;
  email: string;
  role: "admin" | "member";
  state: "pending" | "used" | "revoked" | "expired";
  expiresAt: number;
  createdAt: number;
}
export interface InvitationPreview {
  teamName: string;
  emailHint: string;
  role: TeamRole;
  expiresAt: number;
  registrationAllowed: boolean;
}
export interface OffboardingProject {
  projectId: string;
  name: string;
  logicalOwnerId: string;
  requiresOwnerTransfer: boolean;
  tasks: {
    id: string;
    title: string;
    revision: number;
    assigneeId: string | null;
    reviewerId: string | null;
  }[];
  runs: { id: string; state: string }[];
  eligibleOwners: { userId: string; label: string }[];
  eligibleAssignees: { userId: string; label: string }[];
  eligibleReviewers: { userId: string; label: string }[];
}
export interface OffboardingImpact {
  impactDigest: string;
  member: TeamMember;
  teamRevision: number;
  projects: OffboardingProject[];
  blockers: { code: string; projectId?: string; runId?: string }[];
}
export interface OffboardingPlan {
  revision: number;
  id: string;
  memberId: string;
  state: "planned" | "stopping" | "completed";
  expiresAt: number;
  createdAt: number;
  pendingStops: number;
  error: string | null;
}
export interface HandoffSelection {
  projectId: string;
  newOwnerId?: string;
  assigneeId: string | null;
  reviewerId: string | null;
}
const root = "/api/v1/teams";
const path = (id: string) => `${root}/${encodeURIComponent(id)}`;
const body = (method: string, data: unknown = {}) => ({
  method,
  body: JSON.stringify(data),
});
export const teamsApi = {
  list: () => fetchJson(root) as Promise<{ teams: Team[] }>,
  create: (name: string) =>
    fetchJson(root, body("POST", { name })) as Promise<{ team: Team }>,
  detail: (id: string) => fetchJson(path(id)) as Promise<TeamDetail>,
  rename: (id: string, name: string, expectedRevision: number) =>
    fetchJson(path(id), body("PATCH", { name, expectedRevision })) as Promise<{
      team: Team;
    }>,
  transfer: (id: string, newOwnerId: string, expectedRevision: number) =>
    fetchJson(
      path(id) + "/transfer-owner",
      body("POST", { newOwnerId, expectedRevision }),
    ) as Promise<{ team: Team }>,
  close: (id: string, expectedRevision: number) =>
    fetchJson(
      path(id) + "/close",
      body("POST", { expectedRevision }),
    ) as Promise<{ team: Team }>,
  member: (
    id: string,
    userId: string,
    role: "admin" | "member",
    expectedRevision: number,
  ) =>
    fetchJson(
      path(id) + "/members/" + encodeURIComponent(userId),
      body("PATCH", { role, expectedRevision }),
    ),
  candidates: (id: string) =>
    fetchJson(path(id) + "/enrollment-candidates") as Promise<{
      projects: { id: string; name: string; revision: number }[];
    }>,
  enroll: (
    id: string,
    projectId: string,
    expectedProjectRevision: number,
    expectedTeamRevision: number,
  ) =>
    fetchJson(
      path(id) + "/projects",
      body("POST", {
        projectId,
        expectedProjectRevision,
        expectedTeamRevision,
      }),
    ),
  transferProject: (
    id: string,
    projectId: string,
    newOwnerId: string,
    expectedRevision: number,
  ) =>
    fetchJson(
      path(id) +
        "/projects/" +
        encodeURIComponent(projectId) +
        "/transfer-owner",
      body("POST", { newOwnerId, expectedRevision }),
    ),
  invitations: (id: string) =>
    fetchJson(path(id) + "/invitations") as Promise<{
      invitations: TeamInvitation[];
    }>,
  invite: (
    id: string,
    email: string,
    role: "admin" | "member",
    expiresInHours: number,
  ) =>
    fetchJson(
      path(id) + "/invitations",
      body("POST", { email, role, expiresInHours }),
    ) as Promise<{ invitation: TeamInvitation; token: string }>,
  revoke: (id: string, invitationId: string) =>
    fetchJson(path(id) + "/invitations/" + encodeURIComponent(invitationId), {
      method: "DELETE",
    }),
  inspect: (token: string) =>
    fetchJson(
      "/api/v1/auth/team-invitations/inspect",
      body("POST", { token }),
    ) as Promise<{ invitation: InvitationPreview }>,
  accept: (token: string) =>
    fetchJson(
      root + "/invitations/accept",
      body("POST", { token }),
    ) as Promise<{ team: Team; membership: TeamMember }>,
  register: (token: string, email: string, password: string) =>
    fetchJson(
      "/api/v1/auth/team-invitations/register",
      body("POST", { token, email, password }),
    ) as Promise<{
      token: string;
      user: User;
      team: Team;
      membership: TeamMember;
    }>,
  impact: (id: string, userId: string) =>
    fetchJson(
      path(id) + "/members/" + encodeURIComponent(userId) + "/offboarding",
    ) as Promise<{ impact: OffboardingImpact }>,
  plan: (
    id: string,
    memberId: string,
    expectedMemberRevision: number,
    handoffs: HandoffSelection[],
    expectedImpactDigest: string,
  ) =>
    fetchJson(
      path(id) + "/offboarding-plans",
      body("POST", {
        memberId,
        expectedMemberRevision,
        handoffs,
        expectedImpactDigest,
      }),
    ) as Promise<{ plan: OffboardingPlan; confirmationToken: string }>,
  commit: (id: string, planId: string, confirmationToken: string) =>
    fetchJson(
      path(id) + "/offboarding-plans/" + encodeURIComponent(planId) + "/commit",
      body("POST", { confirmationToken }),
    ) as Promise<{ plan: OffboardingPlan }>,
  plans: (id: string) =>
    fetchJson(path(id) + "/offboarding-plans") as Promise<{
      plans: OffboardingPlan[];
    }>,
  revisePlan: (
    id: string,
    planId: string,
    expectedPlanRevision: number,
    expectedImpactDigest: string,
    handoffs: HandoffSelection[],
  ) =>
    fetchJson(
      path(id) + "/offboarding-plans/" + encodeURIComponent(planId),
      body("PATCH", { expectedPlanRevision, expectedImpactDigest, handoffs }),
    ) as Promise<{ plan: OffboardingPlan }>,
  planStatus: (id: string, planId: string) =>
    fetchJson(
      path(id) + "/offboarding-plans/" + encodeURIComponent(planId),
    ) as Promise<{ plan: OffboardingPlan; impact?: OffboardingImpact }>,
  resume: (id: string, planId: string) =>
    fetchJson(
      path(id) + "/offboarding-plans/" + encodeURIComponent(planId) + "/resume",
      body("POST"),
    ) as Promise<{ plan: OffboardingPlan }>,
};
export interface AccountInvitation {
  id: string;
  code: string;
  createdAt: string;
  expiresAt: string;
  usedByUserId: string | null;
  usedAt: string | null;
}
export const accountsApi = {
  invitations: () =>
    fetchJson("/api/v1/admin/users/invites") as Promise<{
      invites: AccountInvitation[];
    }>,
  invite: () =>
    fetchJson("/api/v1/admin/users/invites", body("POST")) as Promise<{
      invite: AccountInvitation;
    }>,
  revoke: (id: string) =>
    fetchJson("/api/v1/admin/users/invites/" + encodeURIComponent(id), {
      method: "DELETE",
    }),
  reset: (id: string, password: string) =>
    fetchJson(
      "/api/v1/admin/users/" + encodeURIComponent(id) + "/reset-password",
      body("POST", { password }),
    ) as Promise<{ revokedSessions: number }>,
};
