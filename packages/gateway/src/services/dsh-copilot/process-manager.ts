/**
 * Per-user dsh runtime process lifecycle (M2 Copilot BFF).
 *
 * One runtime child process per user, spawned from the dsh-bridge launcher and
 * spoken to over stdio JSON-RPC (see rpc-client.ts). The runtime is reaped
 * after `idleMs` without activity; the dsh session log persists under
 * `stateDir/dsh-sessions/<userId>`, so the next message transparently resumes
 * (kill-and-resume is the verified mid-turn-cancel substitute).
 *
 * Security contract:
 * - the child receives a MINIMAL env (PATH/HOME/TMPDIR/LANG plus the bridge and
 *   LLM variables) — gateway secrets such as OPENFORGE_MASTER_KEY or
 *   OPENFORGE_JWT_SECRET are never inherited;
 * - OPENFORGE_BRIDGE_ENABLE_OPERATE is "1" (M3): the runtime registers the
 *   operate tools, but every call is gated behind the approval bridge — the
 *   dsh pre-execute `ask` is forwarded to the Gateway's pending-action flow
 *   and the tool body runs only after an owner approval;
 * - the decrypted LLM api key exists only in this process's memory and the
 *   child's env; it is never logged. stderr is captured (truncated) for
 *   crash diagnostics only.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DshRpcClient } from "./rpc-client.js";

/** One resolved LLM route for the runtime's single provider ("copilot"). */
export interface DshModelRoute {
  /** pi-ai protocol: anthropic-messages | openai-completions | openai-responses. */
  api: string;
  baseUrl: string;
  /** Decrypted credential — memory-only, never logged. */
  apiKey: string;
  /** Provider-side model id (the `model` of the initialize handshake). */
  model: string;
  modelName: string;
}

export interface DshProcessManagerOptions {
  launcherPath: string;
  gatewayUrl: string;
  bridgeToken: string;
  stateDir: string;
  idleMs: number;
  /** Test override for child_process.spawn. */
  spawnImpl?: typeof spawn;
  /** Extra env merged into the child env last (test/diagnostics hook, e.g. fake-runtime scenario knobs). */
  extraEnv?: Record<string, string> | undefined;
  /**
   * M4: renders the per-user cordis.yml at spawn (visual config). Returning
   * undefined keeps the launcher's packaged default composition (e.g. tests
   * whose fake launcher has no template).
   */
  renderConfig?: ((userId: string) => string | undefined) | undefined;
  /** M4: explicit composition template path (defaults to the launcher's packaged template). */
  configTemplatePath?: string | undefined;
  /** Called when a runtime exits; `expected` distinguishes idle/cancel kills from crashes. */
  onRuntimeExit?: (userId: string, info: { expected: boolean; stderrTail: string }) => void;
}

interface RuntimeEntry {
  child: ChildProcess;
  client: DshRpcClient;
  routeKey: string;
  idleTimer: NodeJS.Timeout;
  expectedExit: boolean;
  stderrTail: string;
}

const STDERR_TAIL_LIMIT = 4096;

export class DshProcessManager {
  private readonly runtimes = new Map<string, RuntimeEntry>();
  private readonly exitListeners = new Set<(userId: string, info: { expected: boolean; stderrTail: string }) => void>();

  constructor(private readonly options: DshProcessManagerOptions) {}

  /** Register a runtime-exit listener (BFF crash handling); returns an unsubscribe. */
  addExitListener(listener: (userId: string, info: { expected: boolean; stderrTail: string }) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  /** Number of live runtimes (diagnostics/tests). */
  get size(): number {
    return this.runtimes.size;
  }

  /**
   * Return the user's live runtime client, spawning (or respawning after a
   * model-route change) as needed, and complete the initialize handshake.
   */
  async ensureClient(userId: string, route: DshModelRoute): Promise<DshRpcClient> {
    const routeKey = keyForRoute(route);
    const existing = this.runtimes.get(userId);
    if (existing && existing.routeKey === routeKey && existing.child.exitCode === null && !existing.child.killed) {
      this.touch(userId, existing);
      return existing.client;
    }
    if (existing) await this.killEntry(userId, existing);
    return this.spawnRuntime(userId, route, routeKey);
  }

  /** Kill the user's runtime (cancel path / shutdown). Returns true when one was live. */
  async killUser(userId: string): Promise<boolean> {
    const entry = this.runtimes.get(userId);
    if (!entry) return false;
    await this.killEntry(userId, entry);
    return true;
  }

  /** Whether the user's runtime process is currently live (dsh-config API status). */
  isRunning(userId: string): boolean {
    const entry = this.runtimes.get(userId);
    return entry !== undefined && entry.child.exitCode === null && !entry.child.killed;
  }

  /** Reset the idle reap timer — called on any runtime activity so a long turn is never reaped mid-stream. */
  touchUser(userId: string): void {
    const entry = this.runtimes.get(userId);
    if (entry) this.touch(userId, entry);
  }

  /** Kill every runtime (gateway shutdown). */
  async disposeAll(): Promise<void> {
    const entries = [...this.runtimes.entries()];
    await Promise.all(entries.map(([userId, entry]) => this.killEntry(userId, entry)));
  }

  private async spawnRuntime(userId: string, route: DshModelRoute, routeKey: string): Promise<DshRpcClient> {
    const spawnImpl = this.options.spawnImpl ?? spawn;
    const sessionRoot = path.join(this.options.stateDir, "dsh-sessions", userId);
    const cwd = path.join(this.options.stateDir, "dsh-workspace", userId);
    mkdirSync(sessionRoot, { recursive: true });
    mkdirSync(cwd, { recursive: true });

    // M4: per-user rendered composition (plugin toggles). The rendered file is
    // rewritten at every spawn, so a config change applies on the next spawn.
    let bridgeConfigPath: string | undefined;
    const rendered = this.options.renderConfig?.(userId);
    if (rendered !== undefined) {
      const configDir = path.join(this.options.stateDir, "dsh-config", userId);
      mkdirSync(configDir, { recursive: true });
      bridgeConfigPath = path.join(configDir, "cordis.yml");
      writeFileSync(bridgeConfigPath, rendered);
    }

    const child = spawnImpl(process.execPath, [this.options.launcherPath], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: buildChildEnv(this.options, userId, route, sessionRoot, cwd, bridgeConfigPath)
    });
    const client = new DshRpcClient(child.stdin!, child.stdout!);
    const entry: RuntimeEntry = {
      child,
      client,
      routeKey,
      idleTimer: this.armIdleTimer(userId),
      expectedExit: false,
      stderrTail: ""
    };
    child.stderr!.on("data", (chunk: Buffer) => {
      entry.stderrTail = (entry.stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_LIMIT);
    });
    child.on("exit", () => {
      clearTimeout(entry.idleTimer);
      this.runtimes.delete(userId);
      client.failAll("dsh runtime exited");
      this.options.onRuntimeExit?.(userId, { expected: entry.expectedExit, stderrTail: entry.stderrTail });
      for (const listener of this.exitListeners) {
        listener(userId, { expected: entry.expectedExit, stderrTail: entry.stderrTail });
      }
    });
    this.runtimes.set(userId, entry);

    try {
      await client.request("initialize", { cwd, provider: "copilot", model: route.model });
    } catch (error) {
      await this.killEntry(userId, entry);
      throw error;
    }
    return client;
  }

  private touch(userId: string, entry: RuntimeEntry): void {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = this.armIdleTimer(userId);
  }

  private armIdleTimer(userId: string): NodeJS.Timeout {
    const timer = setTimeout(() => {
      const entry = this.runtimes.get(userId);
      if (entry) void this.killEntry(userId, entry);
    }, this.options.idleMs);
    timer.unref?.();
    return timer;
  }

  private async killEntry(userId: string, entry: RuntimeEntry): Promise<void> {
    entry.expectedExit = true;
    clearTimeout(entry.idleTimer);
    this.runtimes.delete(userId);
    if (entry.child.exitCode !== null || entry.child.killed) {
      entry.client.failAll("dsh runtime stopped");
      return;
    }
    await new Promise<void>((resolve) => {
      const child = entry.child;
      const done = () => resolve();
      child.once("exit", done);
      child.kill("SIGTERM");
      // A wedged runtime must not block cancel/shutdown forever.
      setTimeout(() => {
        if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
        resolve();
      }, 5_000).unref?.();
    });
  }
}

function keyForRoute(route: DshModelRoute): string {
  return `${route.api}|${route.baseUrl}|${route.model}|${route.apiKey}`;
}

/** Minimal child env: no gateway secrets are inherited. */
function buildChildEnv(
  options: DshProcessManagerOptions,
  userId: string,
  route: DshModelRoute,
  sessionRoot: string,
  cwd: string,
  bridgeConfigPath?: string
): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"]) {
    const value = process.env[name];
    if (value !== undefined) base[name] = value;
  }
  return {
    ...base,
    OPENFORGE_GATEWAY_URL: options.gatewayUrl,
    OPENFORGE_COPILOT_BRIDGE_TOKEN: options.bridgeToken,
    OPENFORGE_USER_ID: userId,
    OPENFORGE_BRIDGE_ENABLE_OPERATE: "1",
    DSH_LLM_API_KEY: route.apiKey,
    DSH_LLM_API: route.api,
    DSH_LLM_BASE_URL: route.baseUrl,
    DSH_LLM_MODEL_ID: route.model,
    DSH_LLM_MODEL_NAME: route.modelName,
    DSH_CWD: cwd,
    DSH_SESSION_ROOT: sessionRoot,
    // M4: present only when a per-user composition was rendered; the launcher
    // falls back to its packaged template otherwise.
    ...(bridgeConfigPath !== undefined ? { DSH_BRIDGE_CONFIG: bridgeConfigPath } : {}),
    ...options.extraEnv
  };
}
