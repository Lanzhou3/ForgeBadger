"use client";

import { useEffect, useState } from "react";

/** Background tabs and reduced-motion users do not run decorative pet timers. */
export function useRobotMotion() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setEnabled(!preference.matches && document.visibilityState === "visible");
    update();
    preference.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      preference.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return enabled;
}
