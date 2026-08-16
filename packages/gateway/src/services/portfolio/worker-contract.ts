import type { CanonicalTaskPacket } from "./task-packet-service.js";

export type PortfolioWorkerOperation = "session_start_ready" | "dispatch_packet" | "follow_up" | "interrupt" | "permission_event" | "completion_candidate" | "bounded_observation";

export interface WorkerBinding {
  commandId: string;
  assignmentId: string;
  attemptId: string;
  sessionId: string;
  adapter: string;
  leaseGeneration: number;
  packetDigest: string;
}

export interface WorkerDispatchAuthorization {
  binding: WorkerBinding;
  packet: CanonicalTaskPacket;
  receiptPermit: string;
  expectedCommandProjectionVersion: number;
}

/** Adapter-facing semantics only; implementations may not accept raw terminal text. */
export interface PortfolioSemanticWorker {
  forwardSessionStart(binding: WorkerBinding): void;
  dispatchCanonicalPacket(authorization: WorkerDispatchAuthorization): void;
  followUp(binding: WorkerBinding, operation: "follow_up"): void;
  interrupt(binding: WorkerBinding): void;
  reportPermission(binding: WorkerBinding): void;
  reportCompletionCandidate(binding: WorkerBinding): void;
  observe(binding: WorkerBinding, operation: "bounded_observation"): void;
}
