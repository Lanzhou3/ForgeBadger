import {
  PORTFOLIO_COMPANION_GRID_SIZE,
  PORTFOLIO_COMPANION_SIZE_PX,
  portfolioCompanionFrames,
  type PortfolioCompanionFrame,
  type PortfolioCompanionPixel,
} from "@/lib/portfolio-companion";

interface PortfolioCompanionSpriteProps {
  frame: PortfolioCompanionFrame;
  flip?: boolean;
  size?: number;
  className?: string;
}

const pixelColors: Record<PortfolioCompanionPixel, string> = {
  H: "hsl(240 5% 92%)",
  B: "hsl(240 5% 65%)",
  W: "hsl(240 5% 45%)",
  D: "hsl(240 9% 16%)",
  V: "hsl(240 12% 8%)",
  E: "hsl(var(--brand))",
  O: "hsl(24 95% 53%)",
  S: "hsl(var(--brand))",
  L: "hsl(240 5% 55%)",
};

export function PortfolioCompanionSprite({
  frame,
  flip = false,
  size = PORTFOLIO_COMPANION_SIZE_PX,
  className,
}: PortfolioCompanionSpriteProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${PORTFOLIO_COMPANION_GRID_SIZE} ${PORTFOLIO_COMPANION_GRID_SIZE}`}
      shapeRendering="crispEdges"
      className={className}
      style={{
        ...(flip ? { transform: "scaleX(-1)" } : undefined),
        filter: "drop-shadow(0 0 2px hsl(var(--brand) / 0.35))",
      }}
      aria-hidden="true"
    >
      {portfolioCompanionFrames[frame].flatMap((row, y) =>
        [...row].map((cell, x) =>
          cell === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={pixelColors[cell as PortfolioCompanionPixel]} />
        )
      )}
    </svg>
  );
}
