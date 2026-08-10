import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { safeResolve } from "../lib/safe-resolve.js";

export const OPENFORGE_OPENCODE_PLUGIN_RELATIVE = ".opencode/plugins/openforge-permission-notify.js";

export const OPENFORGE_OPENCODE_PLUGIN_TEMPLATE = `// OpenForge managed plugin — do not edit by hand
const GATEWAY_URL = process.env.OPENFORGE_GATEWAY_URL || "";
const SESSION_ID = process.env.OPENFORGE_SESSION_ID || "";
const ATTACH_TOKEN = process.env.OPENFORGE_ATTACH_TOKEN || "";

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

async function notify(event) {
  if (!GATEWAY_URL || !SESSION_ID || !ATTACH_TOKEN) return;
  const props = event && event.properties ? event.properties : null;
  try {
    await fetch(
      \`\${GATEWAY_URL.replace(/\\/+$/u, "")}/api/v1/session-hooks/claude-notification/\${encodeURIComponent(SESSION_ID)}\`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openforge-session-id": SESSION_ID,
          "x-openforge-session-token": ATTACH_TOKEN
        },
        body: JSON.stringify({
          hook_event_name: "PermissionRequest",
          notification_type: "permission_prompt",
          message: permissionText(props),
          tool_name: toolName(props),
          adapter: "opencode"
        })
      }
    );
  } catch {
    // non-fatal; must never break OpenCode
  }
}

export const OpenForgePermissionNotify = async () => ({
  event: async ({ event }) => {
    if (event && event.type === "permission.asked") await notify(event);
  }
});
`;

export async function ensureOpenForgeOpenCodePlugin(
  projectRoot: string
): Promise<{ path: string; changed: boolean }> {
  // Throws on path traversal / denied roots / symlink escapes. Security
  // errors must never be swallowed.
  const pluginPath = safeResolve(projectRoot, OPENFORGE_OPENCODE_PLUGIN_RELATIVE);

  let existing: string | null = null;
  try {
    existing = await readFile(pluginPath, "utf8");
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      console.warn(`[opencode-notification-settings] failed to read plugin at ${pluginPath}:`, error);
      return { path: pluginPath, changed: false };
    }
  }

  if (existing === OPENFORGE_OPENCODE_PLUGIN_TEMPLATE) {
    return { path: pluginPath, changed: false };
  }

  try {
    await mkdir(dirname(pluginPath), { recursive: true });
    await writeFile(pluginPath, OPENFORGE_OPENCODE_PLUGIN_TEMPLATE, "utf8");
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
