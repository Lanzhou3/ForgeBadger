"use client";

import { useEffect, useState } from "react";

import { readSessionTabs } from "@/lib/session-tabs";

function readLastPrompts(): Record<string, string> {
  const prompts: Record<string, string> = {};
  for (const tab of readSessionTabs()) {
    if (tab.lastPrompt) {
      prompts[tab.id] = tab.lastPrompt;
    }
  }
  return prompts;
}

/**
 * Browser-only view of the recorded last prompt per session. Starts empty so
 * server and client markup match, then hydrates from localStorage and follows
 * the session-tabs change event.
 */
export function useSessionLastPrompts(): Record<string, string> {
  const [prompts, setPrompts] = useState<Record<string, string>>({});

  useEffect(() => {
    const sync = () => {
      setPrompts(readLastPrompts());
    };
    sync();
    window.addEventListener("forgebadger-session-tabs-changed", sync);
    return () => {
      window.removeEventListener("forgebadger-session-tabs-changed", sync);
    };
  }, []);

  return prompts;
}
