import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { safeResolve } from "../lib/safe-resolve.js";

export const FORGEBADGER_OPENCODE_PLUGIN_RELATIVE = ".opencode/plugins/forgebadger-permission-notify.js";

export const FORGEBADGER_OPENCODE_PLUGIN_TEMPLATE = `// ForgeBadger managed plugin — do not edit by hand
const GATEWAY_URL = process.env.FORGEBADGER_GATEWAY_URL || "";
const SESSION_ID = process.env.FORGEBADGER_SESSION_ID || "";
const ATTACH_TOKEN = process.env.FORGEBADGER_ATTACH_TOKEN || "";

function permissionText(props) {
  if (!props || typeof props !== "object") return "OpenCode permission request";
  // V1 carries {permission, patterns}; V2 carries {action, resources}.
  const name = typeof props.permission === "string" ? props.permission
    : typeof props.action === "string" ? props.action
    : "permission";
  const list = Array.isArray(props.patterns) ? props.patterns
    : Array.isArray(props.resources) ? props.resources
    : [];
  const paths = list.length > 0 ? " " + list.join(", ") : "";
  return \`\${name}\${paths}\`;
}

function toolName(props) {
  if (!props || typeof props !== "object") return "OpenCode";
  if (typeof props.tool === "string") return props.tool;
  if (props.metadata && typeof props.metadata.tool === "string") return props.metadata.tool;
  return "OpenCode";
}

function lifecyclePayload(event) {
  if (event.type === "session.status") {
    return { hook_event_name: "TaskStarted" };
  }
  if (event.type === "permission.asked") {
    return {
      hook_event_name: "PermissionRequest",
      notification_type: "permission_prompt",
      message: permissionText(event.properties),
      tool_name: toolName(event.properties)
    };
  }
  if (event.type === "session.idle") {
    return {
      hook_event_name: "Stop",
      notification_type: "task_completed",
      message: "OpenCode task completed"
    };
  }
  if (event.type === "session.error") {
    return {
      hook_event_name: "StopFailure",
      notification_type: "task_failed",
      message: "OpenCode task failed",
      ...(typeof event.properties?.error?.name === "string" ? { error_type: event.properties.error.name } : {}),
      ...(typeof event.properties?.error?.data?.message === "string" ? { error_message: event.properties.error.data.message } : {})
    };
  }
  // OpenCode 2.x replaces session.error with session.execution.failed and
  // flattens the error to { type, message }.
  if (event.type === "session.execution.failed") {
    const failure = event.properties?.error;
    return {
      hook_event_name: "StopFailure",
      notification_type: "task_failed",
      message: "OpenCode task failed",
      ...(typeof failure?.type === "string" ? { error_type: failure.type } : {}),
      ...(typeof failure?.message === "string" ? { error_message: failure.message } : {})
    };
  }
  return null;
}

async function notify(event) {
  if (!GATEWAY_URL || !SESSION_ID || !ATTACH_TOKEN) return;
  const lifecycle = event ? event.hookPayload || lifecyclePayload(event) : null;
  if (!lifecycle) return;
  try {
    const response = await fetch(
      \`\${GATEWAY_URL.replace(/\\/+$/u, "")}/api/v1/session-hooks/cli-notification/\${encodeURIComponent(SESSION_ID)}\`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forgebadger-session-id": SESSION_ID,
          "x-forgebadger-session-token": ATTACH_TOKEN
        },
        body: JSON.stringify({ ...lifecycle, adapter: "opencode", session_id: event.session_id, ...event.summaryFields }),
        signal: AbortSignal.timeout(4500)
      }
    );
    if (!response.ok) {
      const hint = response.status === 401
        ? " Restart this CLI session from ForgeBadger to refresh its notification identity."
        : " Check that the ForgeBadger Gateway is available.";
      console.warn("[ForgeBadger notifications] Delivery failed (HTTP " + response.status + ")." + hint);
    }
  } catch {
    // Fail-open; never print credentials, response bodies, or exception messages.
    console.warn("[ForgeBadger notifications] Delivery failed: could not reach Gateway.");
  }
}

// Pending UI state, not approval policy names, decides whether a person is needed.
export const ForgeBadgerPermissionNotify = async ({ client } = {}) => {
  const active = new Set();
  const pending = new Map();
  const messages = new Map();
  const latestUser = new Map();
  const rounds = new Map();
  const generations = new Map();
  const omittedMessages = new Set();
  let detailsDisabled = false;
  const boundedSet = (map, key, value, max = 128) => {
    map.set(key, value);
    if (map.size > max) map.delete(map.keys().next().value);
  };
  const messageText = (message) => message && !message.omitted ? [...message.parts.values()].join("\\n") : "";
  const capture = (event) => {
    if (detailsDisabled) return;
    const info = event.properties?.info;
    const part = event.properties?.part;
    const value = info || part;
    const id = info?.id || part?.messageID;
    if (!value || typeof id !== "string" || typeof value.sessionID !== "string") return;
    const key = value.sessionID + ":" + id;
    const cached = messages.get(key) || { parts: new Map(), id, sessionID: value.sessionID };
    if (omittedMessages.has(key)) { cached.omitted = true; cached.parts.clear(); }
    if (event.type === "message.updated" && info) {
      // Copy identity/finality only; never cache the full message or reasoning.
      Object.assign(cached, { role: info.role, parentID: info.parentID, finish: info.finish,
        completed: info.time?.completed, error: Boolean(info.error) });
      if (info.role === "user") boundedSet(latestUser, info.sessionID, id);
    } else if (event.type === "message.part.updated" && part?.type === "text") {
      // Oversized fields are omitted whole, before any Gateway-side redaction.
      if (part.synthetic || typeof part.text !== "string" || typeof part.id !== "string"
        || Buffer.byteLength(part.text, "utf8") > 32 * 1024 || (!cached.parts.has(part.id) && cached.parts.size >= 8)) {
        cached.omitted = true; cached.parts.clear();
      } else if (!cached.omitted) cached.parts.set(part.id, part.text);
    }
    messages.set(key, cached);
    if (messages.size > 32) {
      const evicted = messages.keys().next().value;
      messages.delete(evicted); omittedMessages.add(evicted);
      // Tombstones prevent an evicted first part from being reconstructed as
      // a tail-only reply. If even tombstones fill, disable details fail-closed.
      if (omittedMessages.size > 128) { detailsDisabled = true; messages.clear(); omittedMessages.clear(); }
    }
  };
  const remember = (id) => {
    active.add(id);
    if (active.size > 256) active.delete(active.values().next().value);
  };
  const rootSession = async (id) => {
    try {
      // v1 SDK uses path.id; v2 uses sessionID. Each ignores the other key.
      const response = await client.session.get({ path: { id }, sessionID: id }, { signal: AbortSignal.timeout(1500) });
      return response.data?.id === id && !response.data.parentID;
    } catch { return false; }
  };
  return { event: async ({ event }) => {
    if (["message.updated", "message.part.updated"].includes(event?.type)) { capture(event); return; }
    const props = event?.properties;
    const id = props?.sessionID;
    if (!event || !props || typeof id !== "string") return;
    if (event.type === "session.status" && ["busy", "retry"].includes(props.status?.type)) {
      const first = !active.has(id);
      const turn = first ? latestUser.get(id) : rounds.get(id);
      const generation = first ? {} : generations.get(id);
      if (first) { boundedSet(generations, id, generation); if (turn) boundedSet(rounds, id, turn); }
      const fields = turn ? { turn_id: turn } : {};
      const prompt = first && turn ? messageText(messages.get(id + ":" + turn)) : "";
      remember(id);
      if (await rootSession(id)) {
        if (!active.has(id) || generations.get(id) !== generation) return;
        if (prompt) {
          await notify({ session_id: id, summaryFields: fields,
            hookPayload: { hook_event_name: "UserPromptSubmit", prompt } });
        }
        if (!active.has(id) || generations.get(id) !== generation) return;
        await notify({ ...event, session_id: id, summaryFields: fields });
      }
      return;
    }
    if (event.type === "permission.replied") {
      const timer = pending.get(props.requestID);
      if (timer) clearTimeout(timer);
      pending.delete(props.requestID);
      return;
    }
    if (event.type === "permission.asked") {
      if (typeof props.id !== "string" || pending.has(props.id) || pending.size >= 128) return;
      const timer = setTimeout(async () => {
        try {
          const response = await client.permission.list({}, { signal: AbortSignal.timeout(1500) });
          // An auto responder may have consumed the request without a reply
          // event reaching this plugin. Check the current server pending list.
          if (pending.get(props.id) !== timer || !Array.isArray(response.data)
            || !response.data.some(request => request.id === props.id && request.sessionID === id)) return;
          await notify({ ...event, properties: props, session_id: id });
        } catch { /* No confirmed pending request: do not invent an approval. */ }
        finally { if (pending.get(props.id) === timer) pending.delete(props.id); }
      }, 1000);
      timer.unref?.();
      pending.set(props.id, timer);
      return;
    }
    if (event.type !== "session.idle" && event.type !== "session.error") return;
    if (!active.delete(id)) return;
    const generation = generations.get(id);
    const turn = rounds.get(id);
    const final = turn && [...messages.values()].filter(message => message.sessionID === id && message.parentID === turn
      && message.role === "assistant" && message.finish === "stop" && typeof message.completed === "number" && !message.error)
      .sort((a, b) => b.completed - a.completed)[0];
    const text = messageText(final);
    const summaryFields = { ...(turn ? { turn_id: turn } : {}),
      ...(event.type === "session.idle" && text ? { last_assistant_message: text } : {}) };
    // Freeze before awaiting network I/O. A new round cannot change this card.
    rounds.delete(id);
    if (latestUser.get(id) === turn) latestUser.delete(id);
    for (const [key, message] of messages) if (message.sessionID === id && (message.id === turn || message.parentID === turn)) messages.delete(key);
    if (!(await rootSession(id))) return;
    // Preserve an old identified result only when the new round is identified
    // too: the Gateway can then reject its stale work-state transition.
    if (generations.get(id) !== generation && (!turn || !rounds.get(id))) return;
    await notify({ ...event, session_id: id, summaryFields });
  } };
};

// OpenCode 2.x entrypoint. V2 events carry their payload under "data" instead
// of "properties", the public event stream replaces the returned "event" hook,
// and session/permission lookups live on the plugin context.
async function setupOpenCodeV2(ctx) {
  const active = new Set();
  const pending = new Map();
  const prompts = new Map();
  const texts = new Map();
  const generations = new Map();
  let disposed = false;
  const deliver = async (event) => { if (!disposed) await notify(event); };
  const boundedSet = (map, key, value, max) => {
    map.set(key, value);
    if (map.size > (max || 128)) map.delete(map.keys().next().value);
  };
  const remember = (id) => {
    active.add(id);
    if (active.size > 256) active.delete(active.values().next().value);
  };
  const rootSession = async (id) => {
    try {
      const response = await ctx.session.get({ sessionID: id });
      const info = response && response.data ? response.data : response;
      return Boolean(info) && info.id === id && !info.parentID;
    } catch { return false; }
  };
  // The prompt hook is the only V2 surface that carries user prompt text.
  // Without it the engine still reports lifecycle, just without prompt cards.
  try {
    await ctx.session.hook("prompt", (event) => {
      if (disposed) return;
      const id = event && event.sessionID;
      const text = event && event.prompt && event.prompt.text;
      if (typeof id !== "string" || typeof text !== "string") return;
      // Oversized prompts are omitted whole, before any Gateway-side redaction.
      if (Buffer.byteLength(text, "utf8") > 32 * 1024) return;
      boundedSet(prompts, id, {
        messageID: typeof event.messageID === "string" ? event.messageID : "",
        text: text
      });
    });
  } catch { /* Prompt hook unavailable: continue event-only. */ }

  const onEvent = async (event) => {
    if (disposed) return;
    const type = event && event.type;
    const props = event && event.data;
    if (typeof type !== "string" || !props || typeof props !== "object") return;
    const id = props.sessionID;
    if (typeof id !== "string") return;

    if (type === "session.text.ended") {
      if (typeof props.text !== "string" || typeof props.assistantMessageID !== "string") return;
      if (Buffer.byteLength(props.text, "utf8") > 32 * 1024) { texts.delete(id); return; }
      boundedSet(texts, id, { messageID: props.assistantMessageID, text: props.text });
      return;
    }

    if (type === "session.status" && props.status && ["busy", "retry"].includes(props.status.type)) {
      const first = !active.has(id);
      const generation = first ? {} : generations.get(id);
      if (first) boundedSet(generations, id, generation);
      const prompt = first ? prompts.get(id) : undefined;
      const fields = prompt && prompt.messageID ? { turn_id: prompt.messageID } : {};
      remember(id);
      if (await rootSession(id)) {
        if (!active.has(id) || generations.get(id) !== generation) return;
        if (first && prompt && prompt.text) {
          await deliver({ session_id: id, summaryFields: fields,
            hookPayload: { hook_event_name: "UserPromptSubmit", prompt: prompt.text } });
        }
        if (!active.has(id) || generations.get(id) !== generation) return;
        await deliver({ type: type, properties: props, session_id: id, summaryFields: fields });
      }
      return;
    }

    if (type === "permission.replied") {
      const timer = pending.get(props.requestID);
      if (timer) clearTimeout(timer);
      pending.delete(props.requestID);
      return;
    }

    if (type === "permission.asked") {
      if (typeof props.id !== "string" || pending.has(props.id) || pending.size >= 128) return;
      const timer = setTimeout(async () => {
        try {
          if (disposed) return;
          const response = await ctx.permission.list({ sessionID: id });
          const requests = Array.isArray(response) ? response : response && response.data;
          // An auto responder may have consumed the request without a reply
          // event reaching this plugin. Check the current server pending list.
          if (disposed || pending.get(props.id) !== timer || !Array.isArray(requests)
            || !requests.some((request) => request && request.id === props.id && request.sessionID === id)) return;
          await deliver({ type: type, properties: props, session_id: id });
        } catch { /* No confirmed pending request: do not invent an approval. */ }
        finally { if (pending.get(props.id) === timer) pending.delete(props.id); }
      }, 1000);
      if (typeof timer.unref === "function") timer.unref();
      pending.set(props.id, timer);
      return;
    }

    const failed = type === "session.execution.failed";
    const idle = type === "session.idle"
      || (type === "session.status" && props.status && props.status.type === "idle");
    if (!failed && !idle) return;
    if (!active.delete(id)) return;
    const generation = generations.get(id);
    const prompt = prompts.get(id);
    const final = texts.get(id);
    const summaryFields = { ...(prompt && prompt.messageID ? { turn_id: prompt.messageID } : {}),
      ...(idle && final && final.text ? { last_assistant_message: final.text } : {}) };
    // Freeze before awaiting network I/O. A new round cannot change this card.
    prompts.delete(id);
    texts.delete(id);
    if (!(await rootSession(id))) return;
    // A newer round started while identifying; its own lifecycle owns the card.
    if (generations.get(id) !== generation) return;
    await deliver({ type: idle ? "session.idle" : type, properties: props, session_id: id, summaryFields: summaryFields });
  };

  const controller = new AbortController();
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        await onEvent(event).catch(() => {});
      }
    } catch { /* Subscription aborted or failed; notifications stop. */ }
  })();
  return () => {
    disposed = true;
    controller.abort();
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
    active.clear();
    prompts.clear();
    texts.clear();
    generations.clear();
  };
}

// Dual entrypoint: OpenCode 2.x loads the default export and calls setup(ctx);
// OpenCode 1.x (>= 1.15) calls server(input) on the same object. V2 ignores
// extra keys on the default export, and V1 ignores named exports once the
// default export carries id/server.
export default {
  id: "forgebadger-permission-notify",
  server: (input) => ForgeBadgerPermissionNotify(input),
  setup: setupOpenCodeV2
};

`;

export async function ensureForgeBadgerOpenCodePlugin(
  projectRoot: string
): Promise<{ path: string; changed: boolean }> {
  // Throws on path traversal / denied roots / symlink escapes. Security
  // errors must never be swallowed.
  const pluginPath = safeResolve(projectRoot, FORGEBADGER_OPENCODE_PLUGIN_RELATIVE);

  let existing: string | null = null;
  try {
    existing = await readFile(pluginPath, "utf8");
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      console.warn(`[opencode-notification-settings] failed to read plugin at ${pluginPath}:`, error);
      return { path: pluginPath, changed: false };
    }
  }

  if (existing === FORGEBADGER_OPENCODE_PLUGIN_TEMPLATE) {
    return { path: pluginPath, changed: false };
  }

  try {
    await mkdir(dirname(pluginPath), { recursive: true });
    await writeFile(pluginPath, FORGEBADGER_OPENCODE_PLUGIN_TEMPLATE, "utf8");
  } catch (error) {
    // Writing the plugin must never block OpenCode session launch.
    console.warn(`[opencode-notification-settings] failed to write plugin at ${pluginPath}:`, error);
    return { path: pluginPath, changed: false };
  }

  return { path: pluginPath, changed: true };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
