import { PlatformActionRepository } from "../../db/repositories/platform-action-repository.js";
import { buildAgentStack, type AgentStackDeps } from "./agent-stack.js";
import { executionControl } from "./execution-control.js";
/** Gateway-owned recovery pump. Scans users, then uses tenant repositories. */
export function startCopilotRuntime(deps: AgentStackDeps) {
    const control = executionControl(deps.db);
    control.stopped = false;
    function recover(): void {
        if (control.stopped || !deps.db.open)
            return;
        const users = deps.db.prepare("SELECT id FROM users").all() as {
            id: string;
        }[];
        for (const user of users) {
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
    const ready = Promise.resolve().then(recover);
    async function stop(): Promise<void> {
        control.stopped = true;
        clearInterval(timer);
        for (const { controller, stopLease } of control.active.values()) {
            stopLease();
            controller.abort();
        }
        // External tools need not support abort; expiry will classify their unreceipted writes.
        await Promise.race([Promise.allSettled([...control.active.values()].map(v => v.promise)), new Promise(resolve => { const t = setTimeout(resolve, 1000); t.unref(); })]);
    }
    return { ready, stop };
}
