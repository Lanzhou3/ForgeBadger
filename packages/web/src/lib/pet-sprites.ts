import { SIT_FRAME_INTERVAL_MS, WALK_FRAME_INTERVAL_MS, type RobotFrameKey } from "./pixel-robot";
import type { PetId } from "./pet-preference";

export type PetMode = "stand" | "walk" | "sit";
export type PetFrameKey = RobotFrameKey | "walk3" | "walk4" | "walk5" | "walk6" | "walk7" | "walk8"
  | "sit3" | "sit4" | "sit5" | "sit6" | "sitHalfBlink";

interface AnimationStep {
  frame: PetFrameKey;
  durationMs: number;
}

interface PetSpriteConfig {
  assetBase: string;
  nativeFacing: "left" | "right";
  blinkDurationMs: number;
  sheets: Record<PetMode, readonly PetFrameKey[]>;
  animations: Record<PetMode, readonly AnimationStep[]>;
}

const walk: readonly PetFrameKey[] = ["walk1", "walk2", "walk3", "walk4", "walk5", "walk6", "walk7", "walk8"];
const typing: readonly PetFrameKey[] = ["sit1", "sit2", "sit3", "sit4", "sit5", "sit6"];
const typingCycle: readonly AnimationStep[] = typing.map((frame) => ({ frame, durationMs: 80 }));

/** Timings and sheet order match the approved honey-badger-walk-v3 assets. */
export const PET_SPRITES: Record<PetId, PetSpriteConfig> = {
  "honey-badger": {
    assetBase: "/pets/honey-badger-v3",
    nativeFacing: "right",
    blinkDurationMs: 120,
    sheets: { stand: ["stand", "blink"], walk, sit: [...typing, "sitHalfBlink", "sitBlink"] },
    animations: {
      stand: [{ frame: "stand", durationMs: 0 }],
      walk: walk.map((frame) => ({ frame, durationMs: 100 })),
      sit: [
        ...typingCycle, ...typingCycle, ...typingCycle, ...typingCycle,
        { frame: "sit6", durationMs: 120 },
        { frame: "sitHalfBlink", durationMs: 40 },
        { frame: "sitBlink", durationMs: 80 },
        { frame: "sitHalfBlink", durationMs: 40 },
        { frame: "sit6", durationMs: 120 },
      ],
    },
  },
  robot: {
    assetBase: "/pets/fb01",
    nativeFacing: "left",
    blinkDurationMs: 160,
    sheets: { stand: ["stand", "blink"], walk: ["walk1", "walk2"], sit: ["sit1", "sit2", "sitBlink"] },
    animations: {
      stand: [{ frame: "stand", durationMs: 0 }],
      walk: [{ frame: "walk1", durationMs: WALK_FRAME_INTERVAL_MS }, { frame: "walk2", durationMs: WALK_FRAME_INTERVAL_MS }],
      sit: [{ frame: "sit1", durationMs: SIT_FRAME_INTERVAL_MS }, { frame: "sit2", durationMs: SIT_FRAME_INTERVAL_MS }],
    },
  },
};

export function petSpriteFrame(petId: PetId, frame: PetFrameKey) {
  const config = PET_SPRITES[petId];
  for (const sheet of ["stand", "walk", "sit"] as const) {
    const index = config.sheets[sheet].indexOf(frame);
    if (index >= 0) return { src: `${config.assetBase}/${sheet}.webp`, index, count: config.sheets[sheet].length };
  }
  return { src: `${config.assetBase}/stand.webp`, index: 0, count: 2 };
}

/** Expanded image poses still have a bundled SVG fallback if an asset fails. */
export function pixelFallbackFrame(frame: PetFrameKey): RobotFrameKey {
  switch (frame) {
    case "walk3": case "walk4": case "walk7": case "walk8": return "walk2";
    case "walk5": case "walk6": return "walk1";
    case "sit3": case "sit5": return "sit1";
    case "sit4": case "sit6": return "sit2";
    case "sitHalfBlink": return "sitBlink";
    default: return frame;
  }
}
