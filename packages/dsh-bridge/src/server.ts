/**
 * Resume-aware SDK JSON-RPC server plugin for the OpenForge dsh runtime.
 *
 * The stock `@deepseek-ai/dsh-sdk-jsonrpc-server` creates every incoming
 * sessionId through `ctx.agents.create()`, which rejects an id that already
 * has a persisted log ("id collision") — so a restarted runtime process could
 * not continue a user's conversation. This server checks
 * `ctx.sessionPersistence` first and routes known ids through
 * `ctx.agents.resume()` (the pattern `packages/host/apiproxy` uses upstream),
 * which is what makes kill-and-resume work as the mid-turn-cancel substitute.
 *
 * Wire protocol is unchanged: `initialize` / `session/prompt` / `shutdown`
 * plus `session.event`, `session.status`, and `subagent.started` notifications
 * over newline-delimited JSON-RPC on stdio.
 *
 * @module
 */

import type { Context } from "@deepseek-ai/cordis";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import type { Agent, AgentHandle } from "@deepseek-ai/dsh-agent";
import type { SessionPersistence } from "@deepseek-ai/dsh-session-persistence";
import type {
  InitializeParams,
  InitializeResult,
  JsonRpcTransportPeer,
  SessionEventNotification,
  SessionPromptParams,
  SessionPromptResult,
  SubagentStartedNotification,
} from "@deepseek-ai/dsh-sdk-protocol";
import { JsonRpcLineTransport } from "@deepseek-ai/dsh-sdk-protocol";

import { setApprovalTransport } from "./approval-bridge.js";

export const name = "openforge-dsh-jsonrpc-server";
export const inject = ["agents"];

interface SessionRecord {
  handle: AgentHandle;
}

/**
 * SDK server over one booted harness context and transport peer, with
 * resume-aware session creation. Construction subscribes to session and agent
 * lifecycle events until shutdown; reinitialization is unsupported.
 */
export class ResumeAwareSdkServer {
  private cwd = process.cwd();
  private provider = "deepseek-official";
  private model = "deepseek-official";
  private maxTokens: number | undefined;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly sessionCreations = new Map<string, Promise<SessionRecord>>();
  private readonly disposers: (() => void)[] = [];
  private shutdownTask: Promise<Record<string, never>> | undefined;
  private shuttingDown = false;

  constructor(
    private readonly ctx: Context,
    private readonly transport: JsonRpcTransportPeer,
  ) {
    this.disposers.push(ctx.on("session/event", (session, event) => {
      const payload: SessionEventNotification = { sessionId: String(session.id), event };
      this.transport.notify("session.event", payload);
    }));
    this.disposers.push(ctx.on("agent/status", ({ agent, status }) => {
      this.transport.notify("session.status", { sessionId: String(agent.session.id), status });
    }));
    this.disposers.push(ctx.on("session/created", (session) => {
      const parentSession = session.header.parentSession;
      if (parentSession === undefined) return;
      const payload: SubagentStartedNotification = {
        parentSessionId: String(parentSession),
        childSessionId: String(session.id),
      };
      this.transport.notify("subagent.started", payload);
    }));
  }

  /**
   * Configure the SDK route.
   * @param params - SDK handshake parameters.
   * @returns server identity for the handshake.
   */
  initialize(params: InitializeParams): InitializeResult {
    if (params.maxTokens !== undefined
      && (!Number.isSafeInteger(params.maxTokens) || params.maxTokens <= 0)) {
      throw new TypeError("initialize maxTokens must be a positive safe integer");
    }
    this.cwd = params.cwd;
    this.provider = params.provider;
    this.model = params.model;
    this.maxTokens = params.maxTokens;
    return { serverInfo: { name: "deepseek-harness-sdk-runtime", version: "0.0.1" } };
  }

  /**
   * Queue one identified prompt without assigning later activity to it.
   * @param params - target session and user content.
   * @returns the durable message identity.
   */
  async prompt(params: SessionPromptParams): Promise<SessionPromptResult> {
    const rec = await this.getOrCreateSession(params.sessionId);
    if (this.ctx.agents.get(rec.handle.agent.id) !== rec.handle.agent) {
      throw new Error(`session agent was disposed outside the server: ${params.sessionId}`);
    }
    const message = createUserMessage({ content: params.contentBlocks, source: { kind: "user" } });
    rec.handle.agent.followup(message);
    return { messageId: message.id };
  }

  /**
   * Dispose server-owned agents and subscriptions to quiescence.
   * The surrounding context remains running.
   * @returns empty JSON-RPC result.
   */
  shutdown(): Promise<Record<string, never>> {
    this.shutdownTask ??= this.performShutdown();
    return this.shutdownTask;
  }

  private async performShutdown(): Promise<Record<string, never>> {
    this.shuttingDown = true;
    await Promise.allSettled([...this.sessionCreations.values()]);
    this.sessionCreations.clear();
    const records = [...this.sessions.values()];
    this.sessions.clear();
    while (this.disposers.length > 0) {
      try {
        this.disposers.pop()?.();
      } catch {
        // Teardown containment: one failing disposer must not wedge shutdown.
      }
    }
    await Promise.allSettled(records.map((rec) => Promise.resolve().then(() => rec.handle.dispose())));
    return {};
  }

  /**
   * Queue model-facing context into a (possibly resumed) session WITHOUT
   * waking the driver (M3): the Gateway injects the owner's approval decision
   * into a session whose runtime died while the approval was pending, so the
   * next turn learns the outcome from the log instead of retrying blindly.
   * @param params - target session and the decision text.
   * @returns injection acknowledgement.
   */
  async injectContext(params: { sessionId: string; text: string }): Promise<{ injected: true }> {
    if (typeof params.text !== "string" || params.text.trim() === "") {
      throw new TypeError("session/inject text must be a non-empty string");
    }
    const rec = await this.getOrCreateSession(params.sessionId);
    const message = createUserMessage({
      content: [{ type: "text", text: params.text }],
      source: { kind: "plugin", plugin: "openforge-bridge" },
    });
    rec.handle.agent.inject(message);
    return { injected: true };
  }

  /**
   * Dispatch one incoming JSON-RPC request to its typed handler.
   * @param method - the JSON-RPC method name.
   * @param params - the raw params object from the wire.
   * @returns the handler's result, to be serialized as the response.
   */
  async handleRequest(method: string, params: Record<string, unknown> | undefined): Promise<unknown> {
    switch (method) {
      case "initialize":
        return this.initialize(params as unknown as InitializeParams);
      case "session/prompt":
        return this.prompt(params as unknown as SessionPromptParams);
      case "session/inject":
        return this.injectContext(params as unknown as { sessionId: string; text: string });
      case "shutdown":
        return this.shutdown();
      default:
        throw new Error(`unknown DeepSeek Harness SDK runtime method: ${method}`);
    }
  }

  private async getOrCreateSession(sessionId: string): Promise<SessionRecord> {
    if (this.shuttingDown) throw new Error("SDK server is shutting down");
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const pending = this.sessionCreations.get(sessionId);
    if (pending) return pending;
    const creation = this.createSession(sessionId);
    this.sessionCreations.set(sessionId, creation);
    void creation.then(
      () => { this.sessionCreations.delete(sessionId); },
      () => { this.sessionCreations.delete(sessionId); },
    );
    return creation;
  }

  private async createSession(sessionId: string): Promise<SessionRecord> {
    const agentOptions = {
      provider: this.provider,
      model: this.model,
      ...(this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens }),
    };
    // Resume path: a persisted log with this id belongs to a previous process
    // generation; adopt it instead of colliding with it.
    const persistence = this.ctx.get("sessionPersistence") as SessionPersistence | undefined;
    const stored = persistence === undefined
      ? undefined
      : (await persistence.list()).find((header) => String(header.id) === sessionId);
    const handle = stored === undefined
      ? await this.ctx.agents.create({
        sessionId: SessionId(sessionId),
        meta: { cwd: this.cwd },
        agentOptions,
      })
      : await this.ctx.agents.resume({
        resumeSessionId: SessionId(sessionId),
        agentOptions,
      });
    const rec: SessionRecord = { handle };
    this.sessions.set(sessionId, rec);
    return rec;
  }
}

/**
 * Serve SDK requests over stdio. Effect disposal shuts down SDK-created agents
 * and closes the transport. A `shutdown` response is flushed before the root
 * runtime is disposed and the process exits 0; the launcher owns root-context
 * disposal for EOF and signals.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const rootFiber = ctx.root.fiber;
  const transport = new JsonRpcLineTransport(process.stdin, process.stdout);
  const server = new ResumeAwareSdkServer(ctx, transport);
  // M3: the approval answerer forwards questions over this transport.
  setApprovalTransport(transport);

  let exitTask: Promise<void> | undefined;
  const disposeAndExit = (): Promise<void> => {
    exitTask ??= (async () => {
      await Promise.allSettled([Promise.resolve().then(() => transport.flush())]);
      await Promise.allSettled([Promise.resolve().then(() => rootFiber.dispose())]);
      process.exit(0);
    })();
    return exitTask;
  };

  transport.onRequest(async (method, params) => {
    // `initialize` is the SDK's readiness boundary: do not advertise a ready
    // runtime until the complete current plugin tree has settled.
    if (method === "initialize") await ctx.get("loader")?.await();
    const result = await server.handleRequest(method, params);
    if (method === "shutdown") {
      setImmediate(() => { void disposeAndExit(); });
    }
    return result;
  });

  ctx.effect(() => {
    transport.start();
    return async () => {
      setApprovalTransport(undefined);
      await server.shutdown();
      transport.close();
    };
  }, "jsonrpc.serve");
}
