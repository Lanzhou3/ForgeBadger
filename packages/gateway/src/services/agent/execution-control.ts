import type { Database } from "../../db/types.js";
export interface CopilotExecutionControl {
    stopped: boolean;
    active: Map<string, {
        controller: AbortController;
        stopLease: () => void;
        promise: Promise<void>;
    }>;
}
const controls = new WeakMap<Database, CopilotExecutionControl>();
/** Shared across per-request stacks, without retaining credentials or users. */
export function executionControl(db: Database): CopilotExecutionControl {
    let control = controls.get(db);
    if (!control) {
        control = { stopped: false, active: new Map() };
        controls.set(db, control);
    }
    return control;
}
