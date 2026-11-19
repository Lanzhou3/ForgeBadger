import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Animates `[data-flip-id]` elements within `rootRef` across layout changes
 * using the Web Animations API, honoring `prefers-reduced-motion`.
 */
export function useFlip(rootRef: RefObject<HTMLDivElement | null>): void {
  const previous = useRef(
    new Map<string, { x: number; y: number; column: string }>(),
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const origin = root.getBoundingClientRect();
    const next = new Map<string, { x: number; y: number; column: string }>();

    root.querySelectorAll<HTMLElement>("[data-flip-id]").forEach((element) => {
      const id = element.dataset.flipId ?? "";
      if (!id) return;
      const rect = element.getBoundingClientRect();
      const spot = {
        x: rect.left - origin.left + root.scrollLeft,
        y: rect.top - origin.top + root.scrollTop,
        column: element.dataset.flipColumn ?? "",
      };
      next.set(id, spot);
      const was = previous.current.get(id);
      if (!was || reduced || typeof element.animate !== "function") return;
      const dx = was.x - spot.x;
      const dy = was.y - spot.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

      if (was.column !== spot.column) {
        element.animate(
          [
            {
              transform: `translate(${dx}px, ${dy}px) scale(1.04)`,
              zIndex: 30,
              boxShadow: "0 0 0 2px hsl(var(--brand) / 0.55)",
            },
            {
              transform: "translate(0, 0) scale(1)",
              zIndex: 30,
              boxShadow: "0 0 0 2px hsl(var(--brand) / 0)",
            },
          ],
          { duration: 560, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
        );
      } else {
        element.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)` },
            { transform: "translate(0, 0)" },
          ],
          { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
        );
      }
    });

    previous.current = next;
  });
}
