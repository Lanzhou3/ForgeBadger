import type { CopilotSource } from "./api";

export interface CopilotRouteContext {
  source: CopilotSource;
  sourceRefId?: string;
}

const RESERVED_PROJECT_PATHS = new Set(["new", "import"]);

function readRouteId(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const segment = pathname.slice(prefix.length).split("/")[0];
  if (!segment) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function resolveCopilotRouteContext(pathname: string | null | undefined): CopilotRouteContext {
  if (!pathname || pathname === "/copilot") {
    return { source: "copilot" };
  }

  if (pathname === "/") {
    return { source: "dashboard" };
  }
  if (pathname === "/models") {
    return { source: "models" };
  }
  if (pathname === "/settings") {
    return { source: "settings" };
  }

  const projectId = readRouteId(pathname, "/projects/");
  if (projectId && !RESERVED_PROJECT_PATHS.has(projectId)) {
    return { source: "project", sourceRefId: projectId };
  }

  const sessionId = readRouteId(pathname, "/sessions/");
  if (sessionId) {
    return { source: "session", sourceRefId: sessionId };
  }

  return { source: "copilot" };
}
