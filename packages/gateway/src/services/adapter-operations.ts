import { randomUUID } from "node:crypto";

import type { AdapterId } from "./adapter-discovery.js";
import {
  AdapterUpdateError,
  installAdapter,
  updateAdapter,
  type AdapterInstallResult,
  type AdapterUpdateDependencies,
  type AdapterUpdateResult
} from "./adapter-updates.js";

export type AdapterOperationKind = "install" | "update";
export type AdapterOperationState = "running" | "succeeded" | "failed";
export type AdapterOperationResult = AdapterInstallResult | AdapterUpdateResult;

export interface AdapterOperation {
  id: string;
  adapterId: AdapterId;
  kind: AdapterOperationKind;
  state: AdapterOperationState;
  startedAt: string;
  finishedAt?: string;
  result?: AdapterOperationResult;
  error?: string;
}

export class AdapterOperationManager {
  private readonly operations = new Map<string, AdapterOperation>();

  constructor(
    private readonly updateDependencies: AdapterUpdateDependencies = {},
    private readonly onSettled: (operation: AdapterOperation) => void = () => undefined
  ) {}

  start(adapterId: AdapterId, kind: AdapterOperationKind): AdapterOperation {
    const active = [...this.operations.values()].find(
      (operation) => operation.adapterId === adapterId && operation.state === "running"
    );
    if (active) return snapshot(active);

    this.prune();
    const operation: AdapterOperation = {
      id: randomUUID(),
      adapterId,
      kind,
      state: "running",
      startedAt: new Date().toISOString()
    };
    this.operations.set(operation.id, operation);

    const pending = kind === "update"
      ? updateAdapter(adapterId, this.updateDependencies)
      : installAdapter(adapterId, this.updateDependencies);
    void pending.then(
      (result) => this.settle(operation.id, { state: "succeeded", result }),
      (error: unknown) => this.settle(operation.id, {
        state: "failed",
        error: error instanceof AdapterUpdateError
          ? error.message
          : kind === "update" ? "CLI update failed" : "CLI install failed"
      })
    );
    return snapshot(operation);
  }

  list(): AdapterOperation[] {
    return [...this.operations.values()]
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .map(snapshot);
  }

  get(id: string): AdapterOperation | undefined {
    const operation = this.operations.get(id);
    return operation ? snapshot(operation) : undefined;
  }

  private settle(
    id: string,
    outcome: { state: "succeeded"; result: AdapterOperationResult } | { state: "failed"; error: string }
  ): void {
    const operation = this.operations.get(id);
    if (!operation || operation.state !== "running") return;
    operation.state = outcome.state;
    operation.finishedAt = new Date().toISOString();
    if (outcome.state === "succeeded") operation.result = outcome.result;
    else operation.error = outcome.error;
    this.onSettled(snapshot(operation));
  }

  private prune(): void {
    if (this.operations.size < 100) return;
    const oldestFinished = [...this.operations.values()]
      .filter((operation) => operation.state !== "running")
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))[0];
    if (oldestFinished) this.operations.delete(oldestFinished.id);
  }
}

function snapshot(operation: AdapterOperation): AdapterOperation {
  return { ...operation };
}
