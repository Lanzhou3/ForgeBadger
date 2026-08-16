import { createHmac, timingSafeEqual } from "node:crypto";

import { digestPortfolioValue, type PortfolioRepository } from "../../db/repositories/portfolio-repository.js";
import type { CanonicalTaskPacket } from "./task-packet-service.js";
import type { WorkerBinding, WorkerDispatchAuthorization } from "./worker-contract.js";

/** @internal Worker-only launch material; never place this value in a route or websocket payload. */
export interface WorkerLaunchMaterial {
  binding: WorkerBinding;
  workerAckCapability: string;
}

type WorkerBindingInput = WorkerBinding & { now?: Date };
type WorkerAcknowledgementInput = WorkerBindingInput & { capability: string };

/**
 * The worker capability binds exactly this durable assignment tuple. Never
 * spread a caller object here: attach-time fields must not alter the HMAC.
 */
function canonicalWorkerBinding(input: WorkerBinding): WorkerBinding {
  return {
    commandId: input.commandId,
    assignmentId: input.assignmentId,
    attemptId: input.attemptId,
    sessionId: input.sessionId,
    adapter: input.adapter,
    leaseGeneration: input.leaseGeneration,
    packetDigest: input.packetDigest
  };
}

function constantTimeMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function bindingPayload(binding: WorkerBinding): string {
  return JSON.stringify({ ...canonicalWorkerBinding(binding), signalType: "session_start_ready" });
}

/** Validates the fixed SessionStart forwarder without persisting raw HMAC material. */
export function createWorkerSignalService(input: { repository: PortfolioRepository; capabilitySecret: string }) {
  if (input.capabilitySecret.length < 32) throw new Error("PORTFOLIO_WORKER_CAPABILITY_SECRET_INVALID");

  function deriveSessionStartCapabilityForForwarder(binding: WorkerBinding): string {
    return createHmac("sha256", input.capabilitySecret).update(bindingPayload(canonicalWorkerBinding(binding))).digest("hex");
  }

  /**
   * Produces launch-only material after the durable signal and its full lease
   * binding have been checked. The runtime passes it only to the fixed worker,
   * which later returns it through acknowledgeSessionStart.
   */
  function prepareWorkerLaunch(inputValue: WorkerBindingInput): WorkerLaunchMaterial {
    const binding = canonicalWorkerBinding(inputValue);
    const capability = deriveSessionStartCapabilityForForwarder(binding);
    input.repository.claimWorkerSignalLaunch({ ...binding, capabilityDigest: digestPortfolioValue(capability), ...(inputValue.now ? { now: inputValue.now } : {}) });
    return { binding, workerAckCapability: capability };
  }

  function acknowledgeSessionStart(inputValue: WorkerAcknowledgementInput) {
    const binding = canonicalWorkerBinding(inputValue);
    const expected = deriveSessionStartCapabilityForForwarder(binding);
    if (!constantTimeMatch(expected, inputValue.capability)) throw new Error("PORTFOLIO_WORKER_SIGNAL_ACK_REJECTED");
    return input.repository.acknowledgeWorkerSignal({ ...binding, capabilityDigest: digestPortfolioValue(inputValue.capability), ...(inputValue.now ? { now: inputValue.now } : {}) });
  }

  function authorizeCanonicalPacket(inputValue: WorkerAcknowledgementInput): WorkerDispatchAuthorization {
    const binding = canonicalWorkerBinding(inputValue);
    const expected = deriveSessionStartCapabilityForForwarder(binding);
    if (!constantTimeMatch(expected, inputValue.capability)) throw new Error("PORTFOLIO_WRITER_FENCE_REJECTED");
    const signal = input.repository.consumeAcknowledgedWorkerSignal({ ...binding, capabilityDigest: digestPortfolioValue(inputValue.capability), ...(inputValue.now ? { now: inputValue.now } : {}) });
    const command = input.repository.getCommand(binding.commandId);
    const attempt = input.repository.getTaskAttempt(binding.attemptId);
    const packet = attempt?.packetId ? input.repository.getTaskPacket(attempt.packetId) : undefined;
    if (!command || !packet || signal.packetDigest !== packet.packetDigest || command.state !== "awaiting_readiness") {
      throw new Error("PORTFOLIO_DISPATCH_UNKNOWN");
    }
    return { binding, packet: packet.canonicalPacket as unknown as CanonicalTaskPacket, expectedCommandProjectionVersion: command.projectionVersion,
      receiptPermit: receiptPermit(input.capabilitySecret, binding, inputValue.capability) };
  }

  function recordDispatchReceipt(inputValue: WorkerDispatchAuthorization & { receiptDigest: string; idempotencyKey: string; now?: Date }) {
    const expected = receiptPermit(input.capabilitySecret, inputValue.binding, deriveSessionStartCapabilityForForwarder(inputValue.binding));
    if (!constantTimeMatch(expected, inputValue.receiptPermit)) throw new Error("PORTFOLIO_WRITER_FENCE_REJECTED");
    return input.repository.recordWorkerDispatchReceipt({ commandId: inputValue.binding.commandId, assignmentId: inputValue.binding.assignmentId,
      expectedCommandProjectionVersion: inputValue.expectedCommandProjectionVersion, receiptDigest: inputValue.receiptDigest,
      idempotencyKey: inputValue.idempotencyKey, ...(inputValue.now ? { now: inputValue.now } : {}) });
  }

  return { deriveSessionStartCapabilityForForwarder, prepareWorkerLaunch, acknowledgeSessionStart, authorizeCanonicalPacket, recordDispatchReceipt };
}

function receiptPermit(secret: string, binding: WorkerBinding, capability: string): string {
  return createHmac("sha256", secret).update(`receipt:${bindingPayload(canonicalWorkerBinding(binding))}:${capability}`).digest("hex");
}
