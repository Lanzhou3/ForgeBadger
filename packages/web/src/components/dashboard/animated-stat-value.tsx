"use client";

import { useRef } from "react";

import {
  FULL_MOTION_QUERY,
  REDUCED_MOTION_QUERY,
  gsap,
  useGSAP,
} from "@/lib/gsap-motion";

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString();
}

/**
 * Stat number that tweens between values with integer formatting and tabular
 * numerals. Non-numeric placeholders ("—") render statically, and
 * reduced-motion users see the final value immediately. Value changes from
 * React Query refetches tween from the currently displayed number instead of
 * replaying an entrance.
 */
export function AnimatedStatValue({ value }: { value: number | string }) {
  const nodeRef = useRef<HTMLSpanElement>(null);
  const counterRef = useRef({ v: 0 });
  const numericValue = typeof value === "number" ? value : null;

  useGSAP(
    () => {
      const node = nodeRef.current;
      if (node === null || numericValue === null) return;

      const mm = gsap.matchMedia();
      mm.add(REDUCED_MOTION_QUERY, () => {
        counterRef.current.v = numericValue;
        node.textContent = formatInteger(numericValue);
      });
      mm.add(FULL_MOTION_QUERY, () => {
        const from = counterRef.current.v;
        if (from === numericValue) {
          node.textContent = formatInteger(numericValue);
          return;
        }
        gsap.to(counterRef.current, {
          v: numericValue,
          duration: 0.45,
          onUpdate: () => {
            node.textContent = formatInteger(counterRef.current.v);
          },
          onComplete: () => {
            counterRef.current.v = numericValue;
            node.textContent = formatInteger(numericValue);
          },
        });
      });
      return () => {
        mm.revert();
      };
    },
    {
      dependencies: [numericValue],
      revertOnUpdate: true,
    }
  );

  if (numericValue === null) {
    return <span className="tabular-nums">{value}</span>;
  }
  return (
    <span ref={nodeRef} className="tabular-nums">
      {formatInteger(numericValue)}
    </span>
  );
}
