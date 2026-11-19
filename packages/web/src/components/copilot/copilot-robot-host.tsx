"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";

import { RobotWidget } from "@/components/copilot/robot-widget";
import { usePetPreference, usePetVisiblePreference } from "@/hooks/use-pet-preference";
import type { RobotCorner } from "@/lib/pixel-robot";

// Lazy-loaded so the chat panel's heavy dependencies (react-markdown,
// remark-gfm, shiki) never ship in the shared app-shell bundle — they load
// only when the user actually opens the floating chat.
const RobotChatPanel = dynamic(
  () => import("@/components/copilot/robot-chat-panel").then((mod) => mod.RobotChatPanel),
  { ssr: false }
);

function extractProjectIdFromPathname(pathname: string | null): string | undefined {
  if (!pathname) return undefined;
  const match = pathname.match(/^\/projects\/([^/?#]+)/);
  if (!match?.[1]) return undefined;
  const segment = match[1];
  if (segment === "new" || segment === "import") return undefined;
  return decodeURIComponent(segment);
}

/**
 * Dashboard-mounted floating Copilot host. Renders the companion sprite when
 * enabled (and hides only the sprite when `petVisible === false`, keeping the
 * floating quick-chat panel reachable via Cmd/Ctrl+J, Command Palette, or
 * "Ask Copilot" actions). Broadcasts open-corner state to body dataset so
 * edge-docked controls like SessionBookmark yield cleanly.
 */
export function CopilotRobotHost() {
  const router = useRouter();
  const pathname = usePathname();
  const petId = usePetPreference();
  const petVisible = usePetVisiblePreference();
  const [chatOpen, setChatOpen] = useState(false);
  const [overrideProjectId, setOverrideProjectId] = useState<string | undefined>(undefined);
  const [newChatNonce, setNewChatNonce] = useState(0);
  // The panel anchors to the same viewport corner as the robot so it opens
  // beside the pet wherever it was dragged, not always bottom-right.
  const [panelCorner, setPanelCorner] = useState<RobotCorner>("bottom-right");

  const routeProjectId = useMemo(
    () => extractProjectIdFromPathname(pathname),
    [pathname],
  );

  const isCopilotRoute = pathname === "/copilot" || Boolean(pathname?.startsWith("/copilot/"));
  const panelVisible = chatOpen && !isCopilotRoute;

  useEffect(() => {
    const onOpenCopilot = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; newChat?: boolean }>).detail;
      if (detail?.projectId) {
        setOverrideProjectId(detail.projectId);
      } else if (detail?.newChat) {
        setOverrideProjectId(undefined);
      }
      if (detail?.newChat) {
        setNewChatNonce((current) => current + 1);
      }
      setChatOpen(true);
    };
    const onToggleCopilot = () => {
      setOverrideProjectId(undefined);
      setChatOpen((current) => !current);
    };
    window.addEventListener("forgebadger:open-copilot", onOpenCopilot);
    window.addEventListener("forgebadger:toggle-copilot", onToggleCopilot);
    return () => {
      window.removeEventListener("forgebadger:open-copilot", onOpenCopilot);
      window.removeEventListener("forgebadger:toggle-copilot", onToggleCopilot);
    };
  }, []);

  useEffect(() => {
    if (panelVisible) {
      document.body.dataset.copilotPanelOpen = panelCorner;
    } else {
      delete document.body.dataset.copilotPanelOpen;
    }
    window.dispatchEvent(new CustomEvent("forgebadger:copilot-panel-change"));
    return () => {
      delete document.body.dataset.copilotPanelOpen;
      window.dispatchEvent(new CustomEvent("forgebadger:copilot-panel-change"));
    };
  }, [panelVisible, panelCorner]);

  const onActivate = useCallback(() => {
    setOverrideProjectId(undefined);
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
  if (isCopilotRoute) return null;

  return (
    <div data-floating-copilot data-pet={petId}>
      {petVisible ? (
        <RobotWidget
          petId={petId}
          onActivate={onActivate}
          suppressBubbles={pathname === "/copilot"}
          panelOpen={chatOpen}
          onCornerChange={setPanelCorner}
        />
      ) : null}
      {chatOpen && (
        <RobotChatPanel
          corner={panelCorner}
          explicitProjectId={overrideProjectId}
          routeProjectId={routeProjectId}
          newChatNonce={newChatNonce}
          onClose={() => {
            setChatOpen(false);
            setOverrideProjectId(undefined);
          }}
          onExpandFull={onExpandFull}
        />
      )}
    </div>
  );
}
