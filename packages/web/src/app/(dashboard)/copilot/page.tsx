"use client";

import { Suspense } from "react";

import { CopilotChat } from "@/components/copilot/copilot-chat";

/** Primary Copilot surface — conversational agent chat. */
export default function CopilotPage() {
  return (
    <Suspense>
      <CopilotChat />
    </Suspense>
  );
}
