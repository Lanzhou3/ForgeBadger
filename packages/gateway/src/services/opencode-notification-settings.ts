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
      message: "OpenCode task failed"
    };
  }
  return null;
}

async function notify(event) {
  if (!GATEWAY_URL || !SESSION_ID || !ATTACH_TOKEN) return;
  const lifecycle = event ? lifecyclePayload(event) : null;
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
        body: JSON.stringify({ ...lifecycle, adapter: "opencode", session_id: event.session_id }),
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
    const props = event?.properties;
    const id = props?.sessionID;
    if (!event || !props || typeof id !== "string") return;
    if (event.type === "session.status" && ["busy", "retry"].includes(props.status?.type)) {
      remember(id);
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
    if (!active.delete(id) || !(await rootSession(id))) return;
    await notify({ ...event, session_id: id });
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
