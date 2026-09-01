/**
 * Pixel robot companion: frame grids, corner snapping and bubble placement.
 *
 * Frames are 20x20 string grids. Each character maps to a palette key:
 *   "." transparent, "H" highlight, "B" body mid, "W" body shadow,
 *   "D" outline, "V" face visor (near-black), "E" glow (brand),
 *   "O" orange accent (antenna tip / chest indicator dots),
 *   "S" laptop screen (brand), "L" laptop shell.
 * Design cues from the classic toy-robot sprite: antenna with a glowing tip,
 * square head with ear pods, dark visor face with two glowing eyes and a
 * small mouth, chest core in a dark frame, segmented arms with pincer claws,
 * jointed legs with boots. The SVG renderer resolves palette keys to CSS
 * colors; this module stays free of rendering concerns so it can be unit
 * tested in isolation.
 */

export type RobotCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type RobotFrameKey = "stand" | "blink" | "walk1" | "walk2" | "sit1" | "sit2" | "sitBlink";

export const PIXEL_GRID_SIZE = 20;

export const PIXEL_PALETTE_KEYS = ["B", "D", "E", "O", "S", "L", "H", "W", "V"] as const;

export type PixelPaletteKey = (typeof PIXEL_PALETTE_KEYS)[number];

const pixelPaletteKeySet = new Set<string>(PIXEL_PALETTE_KEYS);

// Standing idle, front facing. Antenna with orange tip, ear pods on both
// sides of the head, glowing eyes (E) inside the dark visor (V), chest core
// with orange indicator dots, pincer claws, boots. Top-left highlight (H),
// right/bottom shadow (W).
const standFrame = [
  "....................",
  ".........OO.........",
  ".........DD.........",
  ".........DD.........",
  "....DDDDDDDDDDDD....",
  "....DHHBBBBBBBWD....",
  "..DBDBVVVVVVVVBDBD..",
  "..DBDBVEEVVEEVBDBD..",
  "..DBDBVEEVVEEVBDBD..",
  "....DBVVVEEVVVBD....",
  "....DBVVVVVVVVBD....",
  "....DBBBBBBBBWWD....",
  "....DDDDDDDDDDDD....",
  ".....DDDDDDDDDD.....",
  "...DBDBBDDDDOODBD...",
  "...DBDHBDEEDBWDBD...",
  "..DBDDBBDDDDBWDDBD..",
  "..D.D..DB..BD..D.D..",
  ".....DBBD..DBBD.....",
  ".....DDDD..DDDD.....",
] as const;

// Blink: the top eye row closes into the visor (eyelid dropping down).
const blinkFrame = [
  "....................",
  ".........OO.........",
  ".........DD.........",
  ".........DD.........",
  "....DDDDDDDDDDDD....",
  "....DHHBBBBBBBWD....",
  "..DBDBVVVVVVVVBDBD..",
  "..DBDBVVVVVVVVBDBD..",
  "..DBDBVEEVVEEVBDBD..",
  "....DBVVVEEVVVBD....",
  "....DBVVVVVVVVBD....",
  "....DBBBBBBBBWWD....",
  "....DDDDDDDDDDDD....",
  ".....DDDDDDDDDD.....",
  "...DBDBBDDDDOODBD...",
  "...DBDHBDEEDBWDBD...",
  "..DBDDBBDDDDBWDDBD..",
  "..D.D..DB..BD..D.D..",
  ".....DBBD..DBBD.....",
  ".....DDDD..DDDD.....",
] as const;

// Walk frame 1: legs stride apart, boots planted wide.
const walk1Frame = [
  "....................",
  ".........OO.........",
  ".........DD.........",
  ".........DD.........",
  "....DDDDDDDDDDDD....",
  "....DHHBBBBBBBWD....",
  "..DBDBVVVVVVVVBDBD..",
  "..DBDBVEEVVEEVBDBD..",
  "..DBDBVEEVVEEVBDBD..",
  "....DBVVVEEVVVBD....",
  "....DBVVVVVVVVBD....",
  "....DBBBBBBBBWWD....",
  "....DDDDDDDDDDDD....",
  ".....DDDDDDDDDD.....",
  "...DBDBBDDDDOODBD...",
  "...DBDHBDEEDBWDBD...",
  "..DBDDBBDDDDBWDDBD..",
  "..D.D..DB....BDD.D..",
  ".....DBBD..DBBD.....",
  ".....DDDD..DDDD.....",
] as const;

// Walk frame 2: legs pass together mid-stride.
const walk2Frame = [
  "....................",
  ".........OO.........",
  ".........DD.........",
  ".........DD.........",
  "....DDDDDDDDDDDD....",
  "....DHHBBBBBBBWD....",
  "..DBDBVVVVVVVVBDBD..",
  "..DBDBVEEVVEEVBDBD..",
  "..DBDBVEEVVEEVBDBD..",
  "....DBVVVEEVVVBD....",
  "....DBVVVVVVVVBD....",
  "....DBBBBBBBBWWD....",
  "....DDDDDDDDDDDD....",
  ".....DDDDDDDDDD.....",
  "...DBDBBDDDDOODBD...",
  "...DBDHBDEEDBWDBD...",
  "..DBDDBBDDDDBWDDBD..",
  "..D.D...DBBD...D.D..",
  "........DBBD........",
  "........DDDD........",
] as const;

// Sitting frame 1: robot sits in front of its clamshell laptop (brand-glow
// screen), arm resting on the keyboard, legs stretched forward.
const sit1Frame = [
  "....................",
  ".......OO...........",
  ".......DD...........",
  "..DDDDDDDDDDDD......",
  "..DHHBBBBBBBWD......",
  "..DBVVVVVVVVBD......",
  "..DBVEEVVEEVBD......",
  "..DBVEEVVEEVBD......",
  "..DBVVVEEVVVBD......",
  "..DBVVVVVVVVBD......",
  "..DBBBBBBBBWWD..LLLL",
  "..DDDDDDDDDDDD..LSSL",
  "....DDDDDDDD....LSSL",
  "....DHBDEDBD....LLLL",
  "....DBBDEDWDBB......",
  "....DBBBBBBD..LLLLL.",
  "....DDDDDDDD........",
  "....................",
  "....................",
  "....................",
] as const;

// Sitting frame 2: the laptop screen cursor blinks off (typing activity).
const sit2Frame = [
  "....................",
  ".......OO...........",
  ".......DD...........",
  "..DDDDDDDDDDDD......",
  "..DHHBBBBBBBWD......",
  "..DBVVVVVVVVBD......",
  "..DBVEEVVEEVBD......",
  "..DBVEEVVEEVBD......",
  "..DBVVVEEVVVBD......",
  "..DBVVVVVVVVBD......",
  "..DBBBBBBBBWWD..LLLL",
  "..DDDDDDDDDDDD..LSSL",
  "....DDDDDDDD....LSLL",
  "....DHBDEDBD....LLLL",
  "....DBBDEDWDBB......",
  "....DBBBBBBD..LLLLL.",
  "....DDDDDDDD........",
  "....................",
  "....................",
  "....................",
] as const;

// Sit blink: same as sit1 with the top eye row closed into the visor. The
// laptop cursor state freezes for the blink's ~160ms, which is imperceptible.
const sitBlinkFrame = [
  "....................",
  ".......OO...........",
  ".......DD...........",
  "..DDDDDDDDDDDD......",
  "..DHHBBBBBBBWD......",
  "..DBVVVVVVVVBD......",
  "..DBVVVVVVVVBD......",
  "..DBVEEVVEEVBD......",
  "..DBVVVEEVVVBD......",
  "..DBVVVVVVVVBD......",
  "..DBBBBBBBBWWD..LLLL",
  "..DDDDDDDDDDDD..LSSL",
  "....DDDDDDDD....LSSL",
  "....DHBDEDBD....LLLL",
  "....DBBDEDWDBB......",
  "....DBBBBBBD..LLLLL.",
  "....DDDDDDDD........",
  "....................",
  "....................",
  "....................",
] as const;

export const ROBOT_FRAMES: Record<RobotFrameKey, readonly string[]> = {
  stand: standFrame,
  blink: blinkFrame,
  walk1: walk1Frame,
  walk2: walk2Frame,
  sit1: sit1Frame,
  sit2: sit2Frame,
  sitBlink: sitBlinkFrame,
};

export function pixelFrameIsValid(frame: readonly string[]): boolean {
  if (frame.length !== PIXEL_GRID_SIZE) return false;
  return frame.every(
    (row) =>
      row.length === PIXEL_GRID_SIZE &&
      [...row].every((cell) => cell === "." || pixelPaletteKeySet.has(cell))
  );
}

export interface ViewportSize {
  width: number;
  height: number;
}

export function nearestCorner(x: number, y: number, viewport: ViewportSize): RobotCorner {
  const horizontal = x < viewport.width / 2 ? "left" : "right";
  const vertical = y < viewport.height / 2 ? "top" : "bottom";
  return `${vertical}-${horizontal}` as RobotCorner;
}

export function isRobotCorner(value: unknown): value is RobotCorner {
  return (
    value === "top-left" ||
    value === "top-right" ||
    value === "bottom-left" ||
    value === "bottom-right"
  );
}

export interface BubblePlacement {
  /** Which side of the robot the bubble sits on. */
  side: "left" | "right";
  /** Whether the bubble is above or below the robot. */
  vertical: "above" | "below";
}

export function bubblePlacement(corner: RobotCorner): BubblePlacement {
  return {
    side: corner.endsWith("right") ? "left" : "right",
    vertical: corner.startsWith("top") ? "below" : "above",
  };
}

export interface RobotPosition {
  x: number;
  y: number;
}

/** Fixed-position coordinates that pin the robot into a viewport corner. */
export function cornerOffsetPosition(
  corner: RobotCorner,
  viewport: ViewportSize,
  robotSize: number,
  margin: number
): RobotPosition {
  return {
    x: corner.endsWith("right") ? viewport.width - robotSize - margin : margin,
    y: corner.startsWith("top") ? margin : viewport.height - robotSize - margin,
  };
}

export const ROBOT_SIZE_PX = 64;
export const CORNER_MARGIN_PX = 20;
export const ROBOT_CORNER_STORAGE_KEY = "forgebadger.robotCorner";
export const BLINK_MIN_INTERVAL_MS = 3000;
export const BLINK_MAX_INTERVAL_MS = 6000;
export const BLINK_DURATION_MS = 160;
export const IDLE_SIT_DELAY_MS = 8000;
export const SIT_FRAME_INTERVAL_MS = 500;
export const WALK_FRAME_INTERVAL_MS = 140;
export const CLICK_DRAG_THRESHOLD_PX = 5;
export const ROBOT_NUDGE_DURATION_MS = 450;
