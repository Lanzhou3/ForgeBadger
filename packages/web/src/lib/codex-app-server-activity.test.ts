import { describe, expect, it } from "vitest";

import {
  describeCodexAppServerActivity,
  type CodexAppServerActivity,
} from "./codex-app-server-activity";

describe("describeCodexAppServerActivity", () => {
  it("maps Codex app-server lifecycle activity types to translation keys", () => {
    const started = activity({
      type: "codex_app_server_started",
      message: "Codex app-server running",
      metadata: {
        runtimeMode: "app-server-websocket",
      },
    });
    const stopped = activity({
      type: "codex_app_server_stopped",
      message: "Codex app-server stopped",
    });
    const error = activity({
      type: "codex_app_server_error",
      status: "error",
      message: "codex crashed",
      metadata: {
        errorMessage: "internal detail",
        runtimeMode: "app-server-stdio",
      },
    });

    expect(describeCodexAppServerActivity(started)).toMatchObject({
      labelKey: "codexAppServer.activity.started",
      detail: "app-server-websocket",
    });
    expect(describeCodexAppServerActivity(stopped).labelKey).toBe("codexAppServer.activity.stopped");
    expect(describeCodexAppServerActivity(error)).toMatchObject({
      labelKey: "codexAppServer.activity.error",
      detail: "app-server-stdio",
      variant: "destructive",
    });
    expect(JSON.stringify(describeCodexAppServerActivity(error))).not.toContain("internal detail");
  });

  it("maps initialize and thread activity types to safe operational details", () => {
    const initialized = describeCodexAppServerActivity(activity({
      type: "codex_app_server_initialized",
      message: "Codex app-server initialized",
      metadata: {
        method: "initialize",
        runtimeMode: "app-server-stdio",
        listen: "stdio://",
      },
    }));
    const thread = describeCodexAppServerActivity(activity({
      type: "codex_app_server_thread_started",
      message: "Codex app-server thread started",
      metadata: {
        method: "thread/start",
        threadId: "thread-1",
        prompt: "secret prompt",
      },
    }));

    expect(initialized).toMatchObject({
      labelKey: "codexAppServer.activity.initialized",
      detail: "initialize · app-server-stdio",
    });
    expect(thread).toMatchObject({
      labelKey: "codexAppServer.activity.threadStarted",
      detail: "thread/start · thread-1",
    });
    expect(JSON.stringify(thread)).not.toContain("secret");
  });

  it("shows notification method and type without leaking transcript-like metadata", () => {
    const presentation = describeCodexAppServerActivity(activity({
      type: "codex_app_server_notification",
      message: "approval needed",
      metadata: {
        method: "notification/prompt",
        activityType: "permission_prompt",
        threadId: "thread-1",
        prompt: "secret prompt",
        text: "secret text",
        response: "secret response",
      },
    }));

    expect(presentation).toEqual({
      labelKey: "codexAppServer.activity.notification",
      message: "approval needed",
      detail: "permission_prompt · notification/prompt · thread-1",
      variant: "secondary",
    });
    expect(JSON.stringify(presentation)).not.toContain("secret");
  });

  it("falls back safely when metadata is not an object", () => {
    expect(describeCodexAppServerActivity(activity({
      type: "unknown",
      message: "raw message",
      status: "error",
      metadata: "not-json",
    }))).toEqual({
      labelKey: "codexAppServer.activity.unknown",
      message: "raw message",
      detail: "",
      variant: "destructive",
    });
  });
});

function activity(input: Partial<CodexAppServerActivity>): CodexAppServerActivity {
  return {
    id: "activity-1",
    type: "codex_app_server_started",
    status: "info",
    message: "message",
    createdAt: "2026-05-09T00:00:00.000Z",
    ...input,
  };
}
