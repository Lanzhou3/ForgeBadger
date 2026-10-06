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
  const name = typeof props.permission === "string" ? props.permission : "permission";
  const paths = Array.isArray(props.patterns) && props.patterns.length > 0
    ? " " + props.patterns.join(", ")
    : "";
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
  return null;
}

async function notify(event) {
  if (!GATEWAY_URL || !SESSION_ID || !ATTACH_TOKEN) return;
  const lifecycle = event ? event.hookPayload || lifecyclePayload(event) : null;
  if (!lifecycle) return;
  try {
    const response = await fetch(
      \`\${GATEWAY_URL.replace(/\\/+$/u, "")}/api/v1/session-hooks/claude-notification/\${encodeURIComponent(SESSION_ID)}\`,
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
