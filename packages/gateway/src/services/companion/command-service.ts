import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../../db/types.js';
import { decryptSecret, encryptSecret, type EncryptedSecret } from '../../crypto/secret-box.js';
import { CompanionCommandRepository, type CompanionCommandRecord } from '../../db/repositories/companion-command-repository.js';
import { CompanionError, CompanionService } from './companion-service.js';
import { companionCommandTypes } from './protocol.js';
import { canonicalCompanionJson } from './transport-crypto.js';
import { CopilotGoalStore } from '../agent/goal-store.js';
import { CopilotConversationLog } from '../agent/conversation-log.js';
import { applyGoalTransition } from '../agent/goal-lifecycle.js';
import { clearGoalFailureCooldown, evaluateGoalContinuation } from '../agent/goal-driver.js';
import { buildAgentStack, type AgentStackDeps } from '../agent/agent-stack.js';
import { AgentError } from '../agent/types.js';
import { AuditLogRepository } from '../../db/repositories/audit-log-repository.js';

const commandSchemas = {
  'goal.create': z.object({ projectId: z.string().max(128), title: z.string().trim().min(1).max(200), spec: z.string().trim().min(1).max(20_000) }).strict(),
  'goal.answer': z.object({ goalId: z.string().uuid(), answer: z.string().trim().min(1).max(4000) }).strict(),
  'goal.pause': z.object({ goalId: z.string().uuid() }).strict(),
  'goal.resume': z.object({ goalId: z.string().uuid() }).strict(),
  'goal.cancel': z.object({ goalId: z.string().uuid() }).strict(),
  'approval.decide': z.object({
    runId: z.string().uuid(), actionId: z.string().uuid(), approved: z.boolean(),
    inputDigest: z.string().regex(/^[a-f0-9]{64}$/)
  }).strict(),
  'run.stop': z.object({ runId: z.string().uuid() }).strict()
} as const;

const capabilities = {
  'goal.create': 'goals.create',
  'goal.answer': 'goals.answer',
  'goal.pause': 'goals.control',
  'goal.resume': 'goals.control',
  'goal.cancel': 'goals.control',
  'approval.decide': 'approvals.decide',
  'run.stop': 'runs.stop'
} as const;

const remoteCommandSchema = z.object({
  protocolVersion: z.literal(1),
  hostId: z.string().regex(/^[a-f0-9]{64}$/),
  deviceId: z.string().uuid(),
  commandId: z.string().uuid(),
  authorityRevision: z.number().int().positive(),
  type: z.enum(companionCommandTypes),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
  payload: z.unknown()
}).strict();

export function companionPayloadDigest(payload: unknown): string {
  return createHash('sha256').update(canonicalCompanionJson(payload)).digest('hex');
}

export class CompanionCommandService {
  private readonly companion: CompanionService;
  constructor(
    private readonly db: Database,
    private readonly masterKey: string,
    private readonly agentDeps: AgentStackDeps,
    private readonly now: () => number = Date.now
  ) {
    this.companion = new CompanionService(db, masterKey, true);
  }

  async execute(raw: unknown): Promise<CompanionCommandRecord> {
    const input = remoteCommandSchema.parse(raw);
    const now = this.now();
    if (input.expiresAt <= now || input.createdAt > now + 300_000) throw new CompanionError('COMPANION_COMMAND_EXPIRED', 409);
    if (input.payloadDigest !== companionPayloadDigest(input.payload)) throw new CompanionError('COMPANION_COMMAND_CONFLICT', 409);
    const { device, userId } = this.companion.authorizeDevice(input.deviceId, input.authorityRevision);
    const host = this.companion.getHostStatus().host;
    if (!host || host.hostId !== input.hostId) throw new CompanionError('COMPANION_AUTHORITY_REJECTED');
    if (!device.capabilities.includes(capabilities[input.type])) throw new CompanionError('COMPANION_AUTHORITY_REJECTED');
    const repository = new CompanionCommandRepository(this.db, userId);
    const existing = repository.get(device.id, input.commandId);
    if (existing) {
      if (existing.payloadDigest !== input.payloadDigest || existing.type !== input.type) {
        throw new CompanionError('COMPANION_COMMAND_CONFLICT', 409);
      }
      return existing;
    }
    const payload = commandSchemas[input.type].parse(input.payload);
    const resultReference = input.type === 'goal.create' ? randomUUID()
      : input.type === 'run.stop' || input.type === 'approval.decide' ? (payload as { runId: string }).runId
      : (payload as { goalId: string }).goalId;
    const accepted = repository.create({
      id: input.commandId,
      deviceId: device.id,
      type: input.type,
      payloadEncrypted: JSON.stringify(encryptSecret(canonicalCompanionJson(payload), { key: this.masterKey })),
      payloadDigest: input.payloadDigest,
      authorityRevision: input.authorityRevision,
      resultReference,
      now
    });
    repository.update(accepted, { status: 'running', effectStatus: 'unknown', now: this.now() });
    try {
      this.companion.authorizeDevice(input.deviceId, input.authorityRevision);
      await this.apply(userId, device.projectIds, input.type, payload, resultReference);
      this.audit(userId, input.type, input.commandId);
      return repository.update(accepted, { status: 'succeeded', effectStatus: 'confirmed', now: this.now() });
    } catch (error) {
      if (error instanceof AgentError || error instanceof CompanionError || error instanceof z.ZodError) {
        return repository.update(accepted, {
          status: 'failed', effectStatus: 'none', errorCode: stableCode(error), now: this.now()
        });
      }
      return repository.update(accepted, {
        status: 'unknown', effectStatus: 'unknown', errorCode: 'COMPANION_COMMAND_UNKNOWN', now: this.now()
      });
    }
  }

  recoverCommands(): void {
    const users = this.db.prepare("SELECT id FROM users WHERE status='active'").all() as Array<{ id: string }>;
    for (const user of users) {
      const repository = new CompanionCommandRepository(this.db, user.id);
      for (const command of repository.unfinished()) {
        try {
          const payload = JSON.parse(decryptSecret(JSON.parse(command.payloadEncrypted) as EncryptedSecret, { key: this.masterKey })) as any;
          const proven = this.effectProven(user.id, command, payload);
          repository.update(command, {
            status: proven ? 'succeeded' : 'unknown',
            effectStatus: proven ? 'confirmed' : 'unknown',
            errorCode: proven ? null : 'COMPANION_RECONCILIATION_REQUIRED',
            now: this.now()
          });
        } catch {
          repository.update(command, {
            status: 'unknown', effectStatus: 'unknown', errorCode: 'COMPANION_RECONCILIATION_REQUIRED', now: this.now()
          });
        }
      }
    }
  }

  private effectProven(userId: string, command: CompanionCommandRecord, payload: any): boolean {
    const targetId = command.resultReference;
    if (!targetId) return false;
    if (command.type === 'goal.create') return Boolean(new CopilotGoalStore(this.db, userId).getGoal(targetId));
    if (command.type === 'run.stop') {
      return new CopilotConversationLog(this.db, userId).getRun(targetId)?.status === 'cancelled';
    }
    if (command.type === 'approval.decide') {
      const expected = payload.approved ? 'approved' : 'rejected';
      return new CopilotConversationLog(this.db, userId).getPendingAction(payload.actionId)?.status === expected;
    }
    const goal = new CopilotGoalStore(this.db, userId).getGoal(targetId);
    if (!goal) return false;
    if (command.type === 'goal.answer') {
      return goal.status === 'active' && Boolean(this.db.prepare('SELECT 1 FROM copilot_goal_journal WHERE user_id=? AND goal_id=? AND note=?')
        .get(userId, targetId, `Owner answer: ${payload.answer}`));
    }
    const expected = command.type === 'goal.pause' ? 'paused' : command.type === 'goal.resume' ? 'active' : 'cancelled';
    return goal.status === expected;
  }

  private async apply(userId: string, projectIds: string[], type: string, payload: any, resultReference: string): Promise<void> {
    if (type === 'goal.create') {
      if (!projectIds.includes(payload.projectId)) throw new CompanionError('COMPANION_AUTHORITY_REJECTED');
      const conversation = new CopilotConversationLog(this.db, userId).createConversation('Companion Goal', payload.projectId);
      const goals = new CopilotGoalStore(this.db, userId);
      const goal = goals.createGoal({
        id: resultReference,
        conversationId: conversation.id,
        projectId: payload.projectId,
        title: payload.title,
        spec: payload.spec,
        grants: []
      });
      try {
        buildAgentStack(this.agentDeps, userId).orchestrator.enqueue({
          userId,
          conversationId: conversation.id,
          goalId: goal.id,
          userText: payload.spec,
          source: 'user',
          clientRequestId: randomUUID()
        });
      } catch {
        goals.setStatus(goal.id, 'cancelled');
        throw new CompanionError('COMPANION_COMMAND_UNKNOWN');
      }
      return;
    }
    if (type === 'approval.decide') {
      const run = this.db.prepare(`SELECT json_extract(input_json,'$.projectId') AS projectId FROM copilot_runs
        WHERE user_id=? AND id=?`).get(userId, payload.runId) as { projectId: string | null } | undefined;
      const pending = new CopilotConversationLog(this.db, userId).getPendingAction(payload.actionId);
      if (!run || !projectIds.includes(run.projectId ?? '') || !pending || pending.runId !== payload.runId
        || pending.inputDigest !== payload.inputDigest || pending.status !== 'pending') {
        throw new CompanionError(pending?.inputDigest === payload.inputDigest ? 'COMPANION_AUTHORITY_REJECTED' : 'COMPANION_APPROVAL_STALE', 409);
      }
      const resumed = await buildAgentStack(this.agentDeps, userId).orchestrator.resumeAfterApproval({
        userId,
        runId: payload.runId,
        actionId: payload.actionId,
        approved: payload.approved,
        decisionOrigin: 'channel',
        async: true
      });
      if (!resumed.resumed) throw new CompanionError('COMPANION_APPROVAL_STALE', 409);
      return;
    }
    if (type === 'run.stop') {
      const run = this.db.prepare(`SELECT json_extract(input_json,'$.projectId') AS projectId FROM copilot_runs
        WHERE user_id=? AND id=?`).get(userId, payload.runId) as { projectId: string | null } | undefined;
      if (!run || !projectIds.includes(run.projectId ?? '')) throw new CompanionError('COMPANION_AUTHORITY_REJECTED');
      await buildAgentStack(this.agentDeps, userId).orchestrator.cancelRun({ userId, runId: payload.runId });
      return;
    }
    const goals = new CopilotGoalStore(this.db, userId);
    const goal = goals.getGoal(payload.goalId);
    if (!goal || !goal.project_id || !projectIds.includes(goal.project_id)) throw new CompanionError('COMPANION_AUTHORITY_REJECTED');
    if (type === 'goal.answer') {
      if (goal.status !== 'blocked' || goal.blocked_reason !== 'awaiting_user' || !goal.pending_question) {
        throw new AgentError('COPILOT_GOAL_STATE', 'Goal is not awaiting an owner answer');
      }
      goals.applyAnswer(goal.id, payload.answer, null);
      clearGoalFailureCooldown(goal.id);
      this.continueGoal(userId, goal.id, `[Goal 用户答复] ${payload.answer}`);
      return;
    }
    const updated = applyGoalTransition(goals, goal, type.slice(5) as 'pause' | 'resume' | 'cancel');
    if (type === 'goal.resume' && updated.status === 'active') {
      clearGoalFailureCooldown(goal.id);
      this.continueGoal(userId, goal.id);
    }
  }

  private continueGoal(userId: string, goalId: string, userText?: string): void {
    try {
      evaluateGoalContinuation(this.agentDeps, userId, goalId, undefined, userText ? { userText } : {});
    } catch {
      // The canonical Goal mutation already succeeded; the recovery sweep can continue it later.
    }
  }

  private audit(userId: string, type: string, commandId: string): void {
    new AuditLogRepository(this.db, userId).create({
      action: `companion.command.${type}`,
      resourceType: 'companion_command',
      resourceId: commandId,
      details: {}
    });
  }
}

function stableCode(error: unknown): string {
  if (error instanceof AgentError) return error.code;
  if (error instanceof CompanionError) return error.code;
  return 'COMPANION_INPUT_INVALID';
}
