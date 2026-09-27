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
    function recover(): void {
        if (control.stopped || !deps.db.open)
            return;
        const users = deps.db.prepare("SELECT id FROM users").all() as {
            id: string;
        }[];
        for (const user of users) {
            try { new MemorySearchIndex(deps.db, user.id).rebuildBatch(); }
            catch { /* Optional indexing retries later; it must not stop other users or runs. */ }
            new CopilotToolArtifactRepository(deps.db, user.id, deps.masterKey).cleanup();
            new CopilotFollowups(deps.db, user.id).promote();
            publishTaskReports(deps, user.id);
            publishTaskReviews(deps, user.id);
            recoverDevelopmentRepairs(deps.db, user.id, deps.eventBus);
            new PlatformActionRepository(deps.db,user.id).recoverExpired();
            const rows = deps.db.prepare("SELECT id FROM copilot_runs WHERE user_id=? AND runtime_version=1 AND status IN ('pending','running') AND (lease_expires_at IS NULL OR lease_expires_at<=?)")
                .all(user.id, Date.now()) as {
                id: string;
            }[];
            for (const row of rows)
                void buildAgentStack(deps, user.id).orchestrator.executeRun(user.id, row.id);
        }
    }
    const timer = setInterval(recover, 5000);
    timer.unref();
    const ready = Promise.all([development.ready, Promise.resolve().then(recover)]).then(() => undefined);
    async function stop(): Promise<void> {
        control.stopped = true;
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
