import type { Database } from '../../../db/types.js';
import { CopilotSkillService, type CopilotSkillQueryOptions, type CopilotSkillDetail } from './copilot-skill-service.js';

export type PlaybookQueryOptions = CopilotSkillQueryOptions;
export interface CopilotPlaybookSummary { id: string; revisionId: string; name: string; description: string; }
export type CopilotPlaybook = CopilotSkillDetail;

/** Legacy playbook names share the versioned Skills service and current availability filters. */
export function listCopilotPlaybooks(db: Database, userId: string, options: PlaybookQueryOptions = {}): CopilotPlaybook[] {
  return new CopilotSkillService(db, userId).details(options);
}
export function listEnabledCopilotPlaybookSummaries(db: Database, userId: string, options: PlaybookQueryOptions = {}): CopilotPlaybookSummary[] {
  return new CopilotSkillService(db, userId).list(options).filter(row => row.available)
    .map(({ id, revisionId, name, description }) => ({ id, revisionId, name, description }));
}
export const listAvailableCopilotSkillSummaries = listEnabledCopilotPlaybookSummaries;
export function loadCopilotPlaybook(db: Database, userId: string, id: string, options: PlaybookQueryOptions = {}): CopilotPlaybook | undefined {
  const row = new CopilotSkillService(db, userId).get(id, options);
  return row?.available ? row : undefined;
}
