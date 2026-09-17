"use client";

import { useCallback, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";

import { RobotWidget } from "@/components/copilot/robot-widget";

// Lazy-loaded so the chat panel's heavy dependencies (react-markdown,
// remark-gfm, shiki) never ship in the shared app-shell bundle — they load
// only when the user actually opens the floating chat.
const RobotChatPanel = dynamic(
  () => import("@/components/copilot/robot-chat-panel").then((mod) => mod.RobotChatPanel),
  { ssr: false }
);

/**
 * Dashboard-mounted pixel robot. Clicking toggles a floating quick-chat panel
 * (the robot stays quiet while it is open, same as on the Copilot page); the
 * panel's "expand" button hands the current conversation to the full console
 * via /copilot?c=<conversationId>.
 */
export function CopilotRobotHost() {
  const router = useRouter();
  const pathname = usePathname();
  const [chatOpen, setChatOpen] = useState(false);

  const onActivate = useCallback(() => {
    setChatOpen((current) => !current);
  }, []);

  const onExpandFull = useCallback(
    (conversationId: string | null) => {
      setChatOpen(false);
      router.push(conversationId ? `/copilot?c=${encodeURIComponent(conversationId)}` : "/copilot");
    },
    [router]
  );

  return (
    <div data-floating-copilot>
      <RobotWidget
        onActivate={onActivate}
        suppressBubbles={pathname === "/copilot"}
        panelOpen={chatOpen}
      />
      {chatOpen && (
        <RobotChatPanel onClose={() => setChatOpen(false)} onExpandFull={onExpandFull} />
      )}
    </div>
  );
}
