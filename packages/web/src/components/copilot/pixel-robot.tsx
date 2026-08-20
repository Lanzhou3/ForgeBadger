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

export function PixelRobot({ frame, flip = false, size = ROBOT_SIZE_PX, className }: PixelRobotProps) {
  const grid = ROBOT_FRAMES[frame];
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${PIXEL_GRID_SIZE} ${PIXEL_GRID_SIZE}`}
      shapeRendering="crispEdges"
      className={className}
      style={{
        ...(flip ? { transform: "scaleX(-1)" } : undefined),
        // Soft brand aura around the sprite silhouette (eyes/screen glow).
        filter: "drop-shadow(0 0 2px hsl(var(--brand) / 0.35))",
      }}
      aria-hidden="true"
    >
      {grid.flatMap((row, y) =>
        [...row].map((cell, x) =>
          cell === "." ? null : (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width={1}
              height={1}
              fill={PIXEL_COLORS[cell as PixelPaletteKey]}
            />
          )
        )
      )}
    </svg>
  );
}
