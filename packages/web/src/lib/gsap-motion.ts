import gsap from "gsap";
import { useGSAP } from "@gsap/react";

// Register once at module load so every importer shares the same plugin
// instance. This module must only be imported from client components.
gsap.registerPlugin(useGSAP);

// Restrained project-wide motion defaults: short durations with a soft ease
// so animation supports the layout instead of stealing attention. Individual
// tweens/timelines may override these.
gsap.defaults({
  duration: 0.35,
  ease: "power2.out",
});

/** Media query matching the user's reduced-motion preference. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Media query matching full-motion permission (explicit no-preference). */
export const FULL_MOTION_QUERY = "(prefers-reduced-motion: no-preference)";

/**
 * Run motion work split by the user's reduced-motion preference.
 *
 * Both handlers fire immediately for the currently matching query and re-fire
 * whenever the preference changes. Call inside useGSAP() (ideally with a
 * scope) so the created gsap.matchMedia context is reverted on cleanup —
 * reduced-motion handlers must leave content in its final, fully readable
 * state instead of animating.
 */
export function matchMotionPreference(handlers: {
  full: () => void;
  reduced?: () => void;
}): gsap.MatchMedia {
  const mm = gsap.matchMedia();
  mm.add(REDUCED_MOTION_QUERY, () => {
    handlers.reduced?.();
  });
  mm.add(FULL_MOTION_QUERY, () => {
    handlers.full();
  });
  return mm;
}

export { gsap, useGSAP };
