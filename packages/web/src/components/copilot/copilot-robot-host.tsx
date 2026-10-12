"use client";

import { useCallback, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";

import { RobotWidget } from "@/components/copilot/robot-widget";
import { usePetPreference } from "@/hooks/use-pet-preference";
import type { RobotCorner } from "@/lib/pixel-robot";

// Lazy-loaded so the chat panel's heavy dependencies (react-markdown,
// remark-gfm, shiki) never ship in the shared app-shell bundle — they load
// only when the user actually opens the floating chat.
const RobotChatPanel = dynamic(
  () => import("@/components/copilot/robot-chat-panel").then((mod) => mod.RobotChatPanel),
  { ssr: false }
);

/**
 * Dashboard-mounted pre-rendered robot. Clicking toggles a floating quick-chat panel
 * (the robot stays quiet while it is open, same as on the Copilot page); the
 * panel's "expand" button hands the current conversation to the full console
 * via /copilot?c=<conversationId>.
 */
export function CopilotRobotHost() {
  const router = useRouter();
  const pathname = usePathname();
  const petId = usePetPreference();
  const [chatOpen, setChatOpen] = useState(false);
  // The panel anchors to the same viewport corner as the robot so it opens
  // beside the pet wherever it was dragged, not always bottom-right.
  const [panelCorner, setPanelCorner] = useState<RobotCorner>("bottom-right");

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

  // The full workspace already provides chat and navigation. A second chat
  // launcher here can cover the composer or settings actions.
  if (pathname === "/copilot" || pathname?.startsWith("/copilot/")) return null;

  return (
    <div data-floating-copilot data-pet={petId}>
      <RobotWidget
        petId={petId}
        onActivate={onActivate}
        suppressBubbles={pathname === "/copilot"}
        panelOpen={chatOpen}
        onCornerChange={setPanelCorner}
      />
      {chatOpen && (
        <RobotChatPanel corner={panelCorner} onClose={() => setChatOpen(false)} onExpandFull={onExpandFull} />
      )}
    </div>
  );
}
