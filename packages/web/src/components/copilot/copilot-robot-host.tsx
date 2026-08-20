"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

import { RobotWidget } from "@/components/copilot/robot-widget";

/**
 * Dashboard-mounted pixel robot. Clicking navigates to the Copilot page; while
 * the user is already on /copilot the robot stays visible but suppresses its
 * notification bubbles (the chat itself is the live surface there).
 */
export function CopilotRobotHost() {
  const router = useRouter();
  const pathname = usePathname();
  const onActivate = useCallback(() => {
    router.push("/copilot");
  }, [router]);
  return (
    <RobotWidget
      onActivate={onActivate}
      suppressBubbles={pathname === "/copilot"}
    />
  );
}