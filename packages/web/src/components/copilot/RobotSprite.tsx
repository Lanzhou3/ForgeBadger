"use client";

import { useState } from "react";

import { PixelRobot } from "@/components/copilot/pixel-robot";
import { ROBOT_SIZE_PX } from "@/lib/pixel-robot";
import { DEFAULT_PET_ID, type PetId } from "@/lib/pet-preference";
import { PET_SPRITES, petSpriteFrame, pixelFallbackFrame, type PetFrameKey } from "@/lib/pet-sprites";
import { cn } from "@/lib/utils";

interface Props {
  frame: PetFrameKey;
  petId?: PetId;
  /** Mirrors the selected pet's native facing direction. */
  flip?: boolean;
  size?: number;
}

/** Each action reuses one pre-rendered strip without per-frame image requests. */
export function RobotSprite({ frame, petId = DEFAULT_PET_ID, flip = false, size = ROBOT_SIZE_PX }: Props) {
  const { src, index, count } = petSpriteFrame(petId, frame);
  const [loadedSheet, setLoadedSheet] = useState<string | null>(null);
  const [failedSheet, setFailedSheet] = useState<string | null>(null);

  if (failedSheet === src) {
    return <PixelRobot frame={pixelFallbackFrame(frame)} flip={flip} size={size} />;
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
        backgroundImage: loadedSheet === src ? undefined : `url(${PET_SPRITES[petId].assetBase}/stand.webp)`,
        backgroundSize: "200% 100%",
        backgroundRepeat: "no-repeat",
      }}
    >
      <img
        key={src}
        src={src}
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
          visibility: loadedSheet === src ? "visible" : "hidden",
        }}
        onLoad={() => setLoadedSheet(src)}
        onError={() => setFailedSheet(src)}
      />
    </span>
  );
}
