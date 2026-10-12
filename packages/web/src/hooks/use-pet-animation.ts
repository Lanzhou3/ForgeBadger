"use client";

import { useEffect, useState } from "react";

import type { PetId } from "@/lib/pet-preference";
import { PET_SPRITES, type PetMode } from "@/lib/pet-sprites";

/** One timer follows the asset timeline and stops on mode, pet, or visibility changes. */
export function usePetAnimation(petId: PetId, mode: PetMode, enabled: boolean) {
  const key = `${petId}:${mode}`;
  const steps = PET_SPRITES[petId].animations[mode];
  const first = steps[0];
  const [playback, setPlayback] = useState({ key, index: 0 });

  useEffect(() => {
    setPlayback({ key, index: 0 });
    if (!enabled || mode === "stand" || !first || steps.length < 2) return;
    const initialDelay = first.durationMs;
    let index = 0;
    let timer: ReturnType<typeof setTimeout>;
    function advance() {
      index = (index + 1) % steps.length;
      setPlayback({ key, index });
      timer = setTimeout(advance, steps[index]?.durationMs ?? initialDelay);
    }
    timer = setTimeout(advance, first.durationMs);
    return () => clearTimeout(timer);
  }, [enabled, first, key, mode, steps]);

  const index = enabled && playback.key === key ? playback.index : 0;
  return (steps[index] ?? first)?.frame ?? "stand";
}
