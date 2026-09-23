/** Recoverable tracking of already-authorized task dispatches; it never launches or retries a CLI. */
import type { Database } from '../../db/types.js';
import type { ForgeBadgerEvent, ForgeBadgerEventBus } from '../event-bus.js';
import { reconcilePendingTaskDispatches } from '../project-manager/task-progress.js';

export interface DispatchSupervisor { stop(): void; }
const supervisors = new WeakMap<Database, { references: number; stop(): void }>();

export function attachDispatchSupervisor(deps: { db: Database; eventBus: ForgeBadgerEventBus }): DispatchSupervisor {
  let active = supervisors.get(deps.db);
  if (!active) {
    const reconcile = () => {
      try { reconcilePendingTaskDispatches(deps.db); } catch { /* The next durable sweep retries transient DB failures. */ }
    };
    const onEvent = (event: ForgeBadgerEvent) => {
      if (event.type === 'claude_notification' && ['task_completed', 'task_failed'].includes(event.notificationType)) reconcile();
    };
    deps.eventBus.on('event', onEvent);
    // The persistent sweep covers fast hooks before receipt commit and process restarts.
    const timer = setInterval(reconcile, 1000);
    timer.unref();
    active = { references: 0, stop() { clearInterval(timer); deps.eventBus.off('event', onEvent); } };
    supervisors.set(deps.db, active);
    reconcile();
  }
  active.references++;
  let stopped = false;
  return { stop() {
    if (stopped) return;
    stopped = true;
    if (--active.references === 0) { active.stop(); supervisors.delete(deps.db); }
  } };
}
