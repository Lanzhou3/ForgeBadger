/** Recovery-only compatibility for verification processes started by older versions.
 * This module cannot launch programs or accept command configuration. */
import { randomBytes } from "node:crypto";
import { connect } from "node:net";
import { z } from "zod";
import { CollaborationError } from "./types.js";
import { authenticMac, readRunner, runnerMac, type RunnerContext } from "./verification-runner-state.js";
import type { VerificationRuntimeStatus } from "./runtime-types.js";

/** A stopped receipt is the only positive exit proof. Missing/unreachable
 * supervisors with a nonterminal identity always retain their workspace fence. */
export async function getVerificationProcessState(input: { cwd: string }): Promise<VerificationRuntimeStatus> {
  try {
    const context = readRunner(input.cwd);
    if (!context) return { status: "none", safeToProceed: true };
    if (context.state.phase === "finished" && context.state.stopped) {
      return { status: "stopped", safeToProceed: true, identity: context.state.id, ...(context.state.result ? { result: context.state.result } : {}) };
    }
    const live = await queryRunner(context, "status");
    return { status: live ? "running" : "unknown", safeToProceed: false, identity: context.state.id };
  } catch { return { status: "unknown", safeToProceed: false }; }
}

export async function assertVerificationProcessStopped(input: { cwd: string }): Promise<void> {
  if (!(await getVerificationProcessState(input)).safeToProceed) {
    throw new CollaborationError(409, "VERIFICATION_RUNTIME_UNRESOLVED", "Verification runtime is running or unresolved; workspace remains fenced");
  }
}

/** Recovery never sends a signal to a recorded PID. The authenticated supervisor
 * owns its original ChildProcess and confirms process-group exit before unlock. */
export async function recoverVerificationProcess(input: { cwd: string }): Promise<VerificationRuntimeStatus> {
  const current = await getVerificationProcessState(input);
  if (current.safeToProceed) return current;
  let context: RunnerContext | undefined;
  try { context = readRunner(input.cwd); } catch { return current; }
  if (!context || !await queryRunner(context, "cancel")) return { ...current, status: "unknown" };
  for (let index = 0; index < 120; index++) {
    await pause(25);
    const state = await getVerificationProcessState(input);
    if (state.safeToProceed) return state;
  }
  return { status: "unknown", safeToProceed: false, identity: context.state.id };
}

function queryRunner(context: RunnerContext, op: "status" | "cancel"): Promise<boolean> {
  return new Promise((resolve) => {
    const challenge = randomBytes(16).toString("hex");
    const socket = connect(context.state.endpoint);
    let data = "";
    let done = false;
    const finish = (value: boolean): void => { if (!done) { done = true; socket.destroy(); resolve(value); } };
    socket.setTimeout(500, () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("end", () => finish(false));
    socket.once("connect", () => socket.write(JSON.stringify({ id: context.state.id, op, challenge, mac: runnerMac(context.state.token, `${context.state.id}:${op}:${challenge}`) }) + "\n"));
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (data.length > 4096) { finish(false); return; }
      if (!data.includes("\n")) return;
      try {
        const parsed = z.object({ payload: z.object({ id: z.string(), phase: z.string(), stopped: z.boolean() }), mac: z.string() }).parse(JSON.parse(data.trim()));
        finish(parsed.payload.id === context.state.id && authenticMac(runnerMac(context.state.token, `${challenge}:${JSON.stringify(parsed.payload)}`), parsed.mac));
      } catch { finish(false); }
    });
  });
}

function pause(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
