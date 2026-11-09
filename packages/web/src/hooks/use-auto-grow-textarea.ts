import { useLayoutEffect } from "react";
import type { RefObject } from "react";

/**
 * Grows a controlled textarea with its content. `rows` plus min-h/max-h
 * classes alone keep a fixed height, so multi-line input stayed one line
 * tall; here the height tracks scrollHeight on every value change while the
 * caller's min-h/max-h classes still clamp the range (overflow scrolls past
 * the max).
 */
export function useAutoGrowTextarea(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}
