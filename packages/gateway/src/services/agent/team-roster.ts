import { z } from 'zod';
import { adapterIds, type CanonicalAdapterId } from '../../lib/adapter-ids.js';

/**
 * Copilot team roster: the owner-configured CLI "members" the Copilot may
 * dispatch goal tasks to. Stored as the `copilot_team` runtime setting; the
 * settings applier pushes the effective value into this process-wide holder
 * (same pattern as command-sandbox's goal check mode).
 */
export const TEAM_MAX_MEMBERS = 12;
export const TEAM_MEMBER_ROLES = ['writer', 'reviewer'] as const;
export type TeamMemberRole = (typeof TEAM_MEMBER_ROLES)[number];

export const teamMemberSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
  name: z.string().trim().min(1).max(40),
  title: z.string().trim().max(60),
  description: z.string().trim().max(500),
  adapter: z.enum(adapterIds),
  roles: z.array(z.enum(TEAM_MEMBER_ROLES)).min(1).max(TEAM_MEMBER_ROLES.length)
    .refine(roles => new Set(roles).size === roles.length, 'roles must be unique'),
  enabled: z.boolean()
}).strict();

export const copilotTeamSchema = z.object({
  maxParallelWriters: z.number().int().min(1).max(6),
  members: z.array(teamMemberSchema).max(TEAM_MAX_MEMBERS)
}).strict().superRefine((team, ctx) => {
  const seen = new Set<string>();
  team.members.forEach((member, index) => {
    if (seen.has(member.id)) ctx.addIssue({ code: 'custom', path: ['members', index, 'id'], message: 'duplicate member id' });
    seen.add(member.id);
  });
});

export type TeamMember = z.infer<typeof teamMemberSchema> & { adapter: CanonicalAdapterId };
export type CopilotTeamRoster = { maxParallelWriters: number; members: TeamMember[] };

export const DEFAULT_COPILOT_TEAM: CopilotTeamRoster = { maxParallelWriters: 3, members: [] };

export function defaultCopilotTeam(): CopilotTeamRoster {
  return { maxParallelWriters: DEFAULT_COPILOT_TEAM.maxParallelWriters, members: [] };
}

let currentRoster: CopilotTeamRoster = defaultCopilotTeam();

export function setCopilotTeamRoster(roster: CopilotTeamRoster): void {
  currentRoster = roster;
}

export function copilotTeamRoster(): CopilotTeamRoster {
  return currentRoster;
}

export function enabledWriterMembers(): TeamMember[] {
  return currentRoster.members.filter(member => member.enabled && member.roles.includes('writer'));
}

export function writerMemberFor(adapter: string): TeamMember | undefined {
  return enabledWriterMembers().find(member => member.adapter === adapter);
}

export function writerMemberById(id: string): TeamMember | undefined {
  return enabledWriterMembers().find(member => member.id === id);
}

export function enabledReviewerMembers(): TeamMember[] {
  return currentRoster.members.filter(member => member.enabled && member.roles.includes('reviewer'));
}

const DESCRIPTION_CLIP = 200;

/** Compact, enabled-only projection for the model. */
export function rosterForModel(): Array<{ id: string; name: string; title: string; description: string; adapter: string; roles: string[] }> {
  return currentRoster.members.filter(member => member.enabled).map(member => {
    const chars = Array.from(member.description);
    return {
      id: member.id, name: member.name, title: member.title,
      description: chars.length > DESCRIPTION_CLIP ? `${chars.slice(0, DESCRIPTION_CLIP).join('')}…` : member.description,
      adapter: member.adapter, roles: [...member.roles]
    };
  });
}
