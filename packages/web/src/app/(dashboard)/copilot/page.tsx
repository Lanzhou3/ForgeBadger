"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

import { CopilotChatPanel } from "@/components/copilot/copilot-chat-panel";
import { resolveCopilotLaunchContext } from "@/lib/copilot";
import type { CopilotSource } from "@/lib/api";

export default function CopilotPage() {
  const searchParams = useSearchParams();
  const launchContext = useMemo(() => resolveCopilotLaunchContext(searchParams), [searchParams]);
  const source = normalizeSource(launchContext.source);

  return (
    <div className="flex h-[calc(100vh-2rem)] min-h-[680px] flex-col p-4">
      <CopilotChatPanel
        variant="page"
        className="min-h-0 flex-1"
        initialSource={source}
        initialSourceRefId={launchContext.sourceRefId}
      />
    </div>
  );
}

function normalizeSource(source: string): CopilotSource {
  if (
    source === "dashboard" ||
    source === "project" ||
    source === "session" ||
    source === "settings" ||
    source === "models"
  ) {
    return source;
  }
  return "copilot";
}
