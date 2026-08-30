"use client";

import { Suspense } from "react";

import { CopilotChat } from "@/components/copilot/copilot-chat";

/** Primary Copilot surface — conversational agent chat. */
export default function CopilotPage() {
  // CopilotChat reads the ?c=<conversationId> deep link via useSearchParams,
  // which requires a Suspense boundary during prerendering.
  return (
    <Suspense>
      <CopilotChat />
    </Suspense>
  );
}
