import { recoverLegacyChannelRuns } from '../channels/channel-run-authority.js';
import { MemorySearchIndex } from './memory-search-index.js';
import { CopilotToolArtifactRepository } from '../../db/repositories/copilot-tool-artifact-repository.js';
import { recoverDevelopmentRepairs } from './development-repair.js';
import { publishTaskReviews } from "./task-review.js";
import { CopilotFollowups } from "./followups.js";
import { startDevelopmentRuntime } from '../development/runtime.js';
import { PlatformActionRepository } from "../../db/repositories/platform-action-repository.js";
import { buildAgentStack, type AgentStackDeps } from "./agent-stack.js";
import { executionControl } from "./execution-control.js";
import { clearAllProvisionalText } from './provisional-text.js';
import { publishTaskReports } from './task-reports.js';
import { attachDispatchSupervisor } from './dispatch-supervisor.js';
/** Gateway-owned recovery pump. Scans users, then uses tenant repositories. */
export function startCopilotRuntime(deps: AgentStackDeps) {
    // Migration fencing precedes both development recovery and native run recovery.
    for (const user of deps.db.prepare('SELECT id FROM users').all() as {id:string}[]) {
        recoverLegacyChannelRuns(deps.db,user.id);
    }
    const development = startDevelopmentRuntime(deps);
    const taskTracking = attachDispatchSupervisor(deps);
    const control = executionControl(deps.db);
    control.stopped = false;
    const failures = new Map<string, { count: number; retryAt: number }>();
    function isolated(operation: string, userId: string, run: () => void): void {
        const key = `${userId}:${operation}`, previous = failures.get(key);
        if (previous && Date.now() < previous.retryAt) return;
        try { run(); failures.delete(key); }
        catch (error) {
            const count = Math.min(5, (previous?.count ?? 0) + 1);
            failures.set(key, { count, retryAt: Date.now() + Math.min(60_000, 5000 * 2 ** (count - 1)) });
            // Do not copy arbitrary provider/tool/SQL error text into process logs.
            console.error('[copilot recovery]', { operation, userId, timestamp: new Date().toISOString(),
                code: error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
                    && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'COPILOT_RECOVERY_FAILED' });
        }
    }
    function recover(): void {
        if (control.stopped || !deps.db.open)
            return;
        const users = deps.db.prepare("SELECT id FROM users").all() as {
            id: string;
        }[];
        for (const user of users) {
            isolated('memory', user.id, () => { new MemorySearchIndex(deps.db, user.id).rebuildBatch(); });
            isolated('artifacts', user.id, () => { new CopilotToolArtifactRepository(deps.db, user.id, deps.masterKey).cleanup(); });
            isolated('followups', user.id, () => { new CopilotFollowups(deps.db, user.id).promote(); });
            isolated('reports', user.id, () => publishTaskReports(deps, user.id));
            isolated('reviews', user.id, () => publishTaskReviews(deps, user.id));
            isolated('repairs', user.id, () => recoverDevelopmentRepairs(deps.db, user.id, deps.eventBus));
            isolated('actions', user.id, () => { new PlatformActionRepository(deps.db,user.id).recoverExpired(); });
            isolated('runs', user.id, () => {
            const rows = deps.db.prepare("SELECT id FROM copilot_runs WHERE user_id=? AND runtime_version=1 AND status IN ('pending','running') AND (lease_expires_at IS NULL OR lease_expires_at<=?)")
                .all(user.id, Date.now()) as {
                id: string;
            }[];
            for (const row of rows)
                void buildAgentStack(deps, user.id).orchestrator.executeRun(user.id, row.id).catch(() => {
                    console.error('[copilot recovery]', { operation: 'execute', userId: user.id, runId: row.id,
                        timestamp: new Date().toISOString(), code: 'COPILOT_RECOVERY_FAILED' });
                });
            });
        }
    }
    const sweep = () => isolated('sweep', '', recover);
    const timer = setInterval(sweep, 5000);
    timer.unref();
    const ready = Promise.all([development.ready, Promise.resolve().then(sweep)]).then(() => undefined);
    async function stop(): Promise<void> {
        control.stopped = true;
        clearAllProvisionalText(deps.db);
        clearInterval(timer);
        taskTracking.stop();
        await development.stop();
        for (const { controller, stopLease } of control.active.values()) {
            stopLease();
            controller.abort();
        }
        // External tools need not support abort; expiry will classify their unreceipted writes.
        await Promise.race([Promise.allSettled([...control.active.values()].map(v => v.promise)), new Promise(resolve => { const t = setTimeout(resolve, 1000); t.unref(); })]);
    }
    return { ready, stop };
}
