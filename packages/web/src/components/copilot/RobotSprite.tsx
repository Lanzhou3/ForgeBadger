"use client";

import { useState } from "react";

import { PixelRobot } from "@/components/copilot/pixel-robot";
import { ROBOT_SIZE_PX, type RobotFrameKey } from "@/lib/pixel-robot";
import { cn } from "@/lib/utils";

interface Props {
  frame: RobotFrameKey;
  /** Source images face left; flip mirrors them to face right. */
  flip?: boolean;
  size?: number;
}

const FRAMES: Record<RobotFrameKey, { sheet: string; index: number; count: number }> = {
  stand: { sheet: "stand", index: 0, count: 2 },
  blink: { sheet: "stand", index: 1, count: 2 },
  walk1: { sheet: "walk", index: 0, count: 2 },
  walk2: { sheet: "walk", index: 1, count: 2 },
  sit1: { sheet: "sit", index: 0, count: 3 },
  sit2: { sheet: "sit", index: 1, count: 3 },
  sitBlink: { sheet: "sit", index: 2, count: 3 },
};

const asset = (sheet: string) => `/pets/fb01/${sheet}.webp`;

/** Blender-rendered frames: no canvas, WebGL context, or per-frame fetches. */
export function RobotSprite({ frame, flip = false, size = ROBOT_SIZE_PX }: Props) {
  const { sheet, index, count } = FRAMES[frame];
  const [loadedSheet, setLoadedSheet] = useState<string | null>(null);
  const [failedSheet, setFailedSheet] = useState<string | null>(null);

  if (failedSheet === sheet) {
    return <PixelRobot frame={frame} flip={flip} size={size} />;
  }

  return (
    <span
      aria-hidden="true"
      data-robot-frame={frame}
      className={cn("pointer-events-none relative block overflow-hidden", flip && "-scale-x-100")}
      style={{
        width: size,
        height: size,
        // Keep a standing pose visible until the requested action is decoded.
        backgroundImage: loadedSheet === sheet ? undefined : `url(${asset("stand")})`,
        backgroundSize: "200% 100%",
        backgroundRepeat: "no-repeat",
      }}
    >
      <img
        key={sheet}
        src={asset(sheet)}
        alt=""
        draggable={false}
        decoding="async"
        width={192 * count}
        height={192}
        className="block max-w-none"
        style={{
          width: size * count,
          height: size,
          transform: `translateX(-${(index * 100) / count}%)`,
          visibility: loadedSheet === sheet ? "visible" : "hidden",
        }}
        onLoad={() => setLoadedSheet(sheet)}
        onError={() => setFailedSheet(sheet)}
      />
    </span>
  );
}
