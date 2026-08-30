import { useMemo } from "react";

import {
  PIXEL_GRID_SIZE,
  ROBOT_FRAMES,
  ROBOT_SIZE_PX,
  type PixelPaletteKey,
  type RobotFrameKey,
} from "@/lib/pixel-robot";

interface PixelRobotProps {
  frame: RobotFrameKey;
  flip?: boolean;
  size?: number;
  /** Extra brand aura, e.g. while an unread notification bubble is visible. */
  glow?: boolean;
  className?: string;
}

const PIXEL_COLORS: Record<PixelPaletteKey, string> = {
  H: "hsl(240 5% 92%)", // top-left highlight (zinc-100)
  B: "hsl(240 5% 65%)", // body mid tone (zinc-400)
  W: "hsl(240 5% 45%)", // body shadow, hue-shifted cool (zinc-500)
  D: "hsl(240 9% 16%)", // outline (cool dark, not pure black)
  V: "hsl(240 12% 8%)", // face visor (near-black)
  E: "hsl(var(--brand))", // glowing eyes / chest core follow the accent theme
  O: "hsl(24 95% 53%)", // orange accent (antenna tip / chest indicator dots)
  S: "hsl(var(--brand))", // laptop screen glow follows the accent theme
  L: "hsl(240 5% 55%)", // laptop shell (zinc-500)
};

/** Emissive palette keys: eyes / chest core / laptop screen get a bloom pass. */
const GLOW_KEYS: ReadonlySet<PixelPaletteKey> = new Set<PixelPaletteKey>(["E", "S"]);

export function PixelRobot({ frame, flip = false, size = ROBOT_SIZE_PX, glow = false, className }: PixelRobotProps) {
  const grid = ROBOT_FRAMES[frame];

  // Group cells by palette key so each material renders as one layer that can
  // be styled as a whole (bloom on emissive parts, flat fill on the shell).
  const layers = useMemo(() => {
    const cellsByKey = new Map<PixelPaletteKey, Array<{ x: number; y: number }>>();
    grid.forEach((row, y) => {
      [...row].forEach((cell, x) => {
        if (cell === ".") return;
        const key = cell as PixelPaletteKey;
        const cells = cellsByKey.get(key);
        if (cells) {
          cells.push({ x, y });
        } else {
          cellsByKey.set(key, [{ x, y }]);
        }
      });
    });
    return [...cellsByKey.entries()];
  }, [grid]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${PIXEL_GRID_SIZE} ${PIXEL_GRID_SIZE}`}
      shapeRendering="crispEdges"
      className={className}
      style={{
        ...(flip ? { transform: "scaleX(-1)" } : undefined),
        // Layered depth: brand aura hugging the silhouette (eyes/screen glow),
        // a faint cool rim lifting the sprite off near-black backgrounds, and
        // a tight dark shadow for grounding.
        filter: [
          "drop-shadow(0 0 3px hsl(var(--brand) / 0.4))",
          "drop-shadow(0 -1px 0 rgb(255 255 255 / 0.05))",
          "drop-shadow(0 1px 1px rgb(0 0 0 / 0.35))",
        ].join(" "),
      }}
      aria-hidden="true"
    >
      {layers.map(([key, cells]) => (
        <g
          key={key}
          className={
            GLOW_KEYS.has(key)
              ? "of-robot-glow-layer"
              : key === "O"
                ? "of-robot-accent-pulse"
                : undefined
          }
        >
          {cells.map(({ x, y }) => (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width={1}
              height={1}
              fill={PIXEL_COLORS[key]}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}
