import type { TranslationKey } from "@/lib/i18n";
import type { SessionActivity } from "./api";

export type CodexAppServerActivity = SessionActivity;

export interface CodexAppServerActivityPresentation {
  labelKey: TranslationKey;
  message: string;
  detail: string;
  variant: "secondary" | "destructive";
}

const ACTIVITY_LABELS: Record<string, TranslationKey> = {
  codex_app_server_started: "codexAppServer.activity.started",
  codex_app_server_stopped: "codexAppServer.activity.stopped",
  codex_app_server_error: "codexAppServer.activity.error",
  codex_app_server_initialized: "codexAppServer.activity.initialized",
  codex_app_server_thread_started: "codexAppServer.activity.threadStarted",
  codex_app_server_notification: "codexAppServer.activity.notification",
};

export function describeCodexAppServerActivity(
  activity: CodexAppServerActivity
): CodexAppServerActivityPresentation {
  const metadata = objectMetadata(activity.metadata);
  return {
    labelKey: ACTIVITY_LABELS[activity.type] ?? "codexAppServer.activity.unknown",
    message: activity.message,
    detail: buildSafeDetail(metadata),
    variant: activity.status === "error" ? "destructive" : "secondary",
  };
}

function objectMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  return metadata as Record<string, unknown>;
}

function buildSafeDetail(metadata: Record<string, unknown>): string {
  return [
    stringField(metadata, "activityType"),
    stringField(metadata, "method"),
    stringField(metadata, "threadId"),
    stringField(metadata, "runtimeMode"),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}

function stringField(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
