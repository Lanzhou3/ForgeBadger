/**
 * Presentation-only state for the floating Portfolio companion. This module
 * has no Gateway, event-stream, terminal, or workflow dependencies.
 */

export type PortfolioCompanionCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type PortfolioCompanionFrame = "stand" | "blink" | "walk1" | "walk2" | "sit1" | "sit2" | "sitBlink";
export type PortfolioCompanionPixel = "B" | "D" | "E" | "O" | "S" | "L" | "H" | "W" | "V";

export interface PortfolioCompanionPosition {
  x: number;
  y: number;
}

export interface PortfolioCompanionViewport {
  width: number;
  height: number;
}

export interface PortfolioCompanionChatPosition {
  left: number;
  top: number;
}

export interface PortfolioCompanionAnchor {
  position: PortfolioCompanionPosition;
  viewport: PortfolioCompanionViewport;
}

export const PORTFOLIO_COMPANION_GRID_SIZE = 20;
export const PORTFOLIO_COMPANION_SIZE_PX = 64;
export const PORTFOLIO_COMPANION_MARGIN_PX = 20;
export const PORTFOLIO_COMPANION_CORNER_STORAGE_KEY = "openforge.portfolioCompanionCorner";
export const PORTFOLIO_COMPANION_CLICK_DRAG_THRESHOLD_PX = 5;
export const PORTFOLIO_COMPANION_BLINK_CLOSED_MS = 80;
export const PORTFOLIO_COMPANION_BLINK_MIN_INTERVAL_MS = 4_500;
export const PORTFOLIO_COMPANION_BLINK_MAX_INTERVAL_MS = 9_000;
const PORTFOLIO_COMPANION_CHAT_WIDTH_PX = 368;
const PORTFOLIO_COMPANION_CHAT_HEIGHT_PX = 432;
const PORTFOLIO_COMPANION_CHAT_GAP_PX = 14;
const PORTFOLIO_COMPANION_CHAT_SAFE_MARGIN_PX = 12;

const stand = [
  "....................", ".........OO.........", ".........DD.........", ".........DD.........",
  "....DDDDDDDDDDDD....", "....DHHBBBBBBBWD....", "..DBDBVVVVVVVVBDBD..", "..DBDBVEEVVEEVBDBD..",
  "..DBDBVEEVVEEVBDBD..", "....DBVVVEEVVVBD....", "....DBVVVVVVVVBD....", "....DBBBBBBBBWWD....",
  "....DDDDDDDDDDDD....", ".....DDDDDDDDDD.....", "...DBDBBDDDDOODBD...", "...DBDHBDEEDBWDBD...",
  "..DBDDBBDDDDBWDDBD..", "..D.D..DB..BD..D.D..", ".....DBBD..DBBD.....", ".....DDDD..DDDD.....",
] as const;

const blink = [
  "....................", ".........OO.........", ".........DD.........", ".........DD.........",
  "....DDDDDDDDDDDD....", "....DHHBBBBBBBWD....", "..DBDBVVVVVVVVBDBD..", "..DBDBVVVVVVVVBDBD..",
  "..DBDBVEEVVEEVBDBD..", "....DBVVVEEVVVBD....", "....DBVVVVVVVVBD....", "....DBBBBBBBBWWD....",
  "....DDDDDDDDDDDD....", ".....DDDDDDDDDD.....", "...DBDBBDDDDOODBD...", "...DBDHBDEEDBWDBD...",
  "..DBDDBBDDDDBWDDBD..", "..D.D..DB..BD..D.D..", ".....DBBD..DBBD.....", ".....DDDD..DDDD.....",
] as const;

const walk1 = [
  "....................", ".........OO.........", ".........DD.........", ".........DD.........",
  "....DDDDDDDDDDDD....", "....DHHBBBBBBBWD....", "..DBDBVVVVVVVVBDBD..", "..DBDBVEEVVEEVBDBD..",
  "..DBDBVEEVVEEVBDBD..", "....DBVVVEEVVVBD....", "....DBVVVVVVVVBD....", "....DBBBBBBBBWWD....",
  "....DDDDDDDDDDDD....", ".....DDDDDDDDDD.....", "...DBDBBDDDDOODBD...", "...DBDHBDEEDBWDBD...",
  "..DBDDBBDDDDBWDDBD..", "..D.D..DB....BDD.D..", ".....DBBD..DBBD.....", ".....DDDD..DDDD.....",
] as const;

const walk2 = [
  "....................", ".........OO.........", ".........DD.........", ".........DD.........",
  "....DDDDDDDDDDDD....", "....DHHBBBBBBBWD....", "..DBDBVVVVVVVVBDBD..", "..DBDBVEEVVEEVBDBD..",
  "..DBDBVEEVVEEVBDBD..", "....DBVVVEEVVVBD....", "....DBVVVVVVVVBD....", "....DBBBBBBBBWWD....",
  "....DDDDDDDDDDDD....", ".....DDDDDDDDDD.....", "...DBDBBDDDDOODBD...", "...DBDHBDEEDBWDBD...",
  "..DBDDBBDDDDBWDDBD..", "..D.D...DBBD...D.D..", "........DBBD........", "........DDDD........",
] as const;

const sit1 = [
  "....................", ".......OO...........", ".......DD...........", "..DDDDDDDDDDDD......",
  "..DHHBBBBBBBWD......", "..DBVVVVVVVVBD......", "..DBVEEVVEEVBD......", "..DBVEEVVEEVBD......",
  "..DBVVVEEVVVBD......", "..DBVVVVVVVVBD......", "..DBBBBBBBBWWD..LLLL", "..DDDDDDDDDDDD..LSSL",
  "....DDDDDDDD....LSSL", "....DHBDEDBD....LLLL", "....DBBDEDWDBB......", "....DBBBBBBD..LLLLL.",
  "....DDDDDDDD........", "....................", "....................", "....................",
] as const;

const sit2 = [
  "....................", ".......OO...........", ".......DD...........", "..DDDDDDDDDDDD......",
  "..DHHBBBBBBBWD......", "..DBVVVVVVVVBD......", "..DBVEEVVEEVBD......", "..DBVEEVVEEVBD......",
  "..DBVVVEEVVVBD......", "..DBVVVVVVVVBD......", "..DBBBBBBBBWWD..LLLL", "..DDDDDDDDDDDD..LSSL",
  "....DDDDDDDD....LSLL", "....DHBDEDBD....LLLL", "....DBBDEDWDBB......", "....DBBBBBBD..LLLLL.",
  "....DDDDDDDD........", "....................", "....................", "....................",
] as const;

const sitBlink = [
  "....................", ".......OO...........", ".......DD...........", "..DDDDDDDDDDDD......",
  "..DHHBBBBBBBWD......", "..DBVVVVVVVVBD......", "..DBVVVVVVVVBD......", "..DBVEEVVEEVBD......",
  "..DBVVVEEVVVBD......", "..DBVVVVVVVVBD......", "..DBBBBBBBBWWD..LLLL", "..DDDDDDDDDDDD..LSSL",
  "....DDDDDDDD....LSSL", "....DHBDEDBD....LLLL", "....DBBDEDWDBB......", "....DBBBBBBD..LLLLL.",
  "....DDDDDDDD........", "....................", "....................", "....................",
] as const;

export const portfolioCompanionFrames: Record<PortfolioCompanionFrame, readonly string[]> = {
  stand, blink, walk1, walk2, sit1, sit2, sitBlink,
};

export function isPortfolioCompanionCorner(value: unknown): value is PortfolioCompanionCorner {
  return value === "top-left" || value === "top-right" || value === "bottom-left" || value === "bottom-right";
}

export function nearestPortfolioCompanionCorner(
  x: number,
  y: number,
  viewport: PortfolioCompanionViewport
): PortfolioCompanionCorner {
  const horizontal = x < viewport.width / 2 ? "left" : "right";
  const vertical = y < viewport.height / 2 ? "top" : "bottom";
  return `${vertical}-${horizontal}` as PortfolioCompanionCorner;
}

/** Pins the companion inside the viewport after drag or viewport resize. */
export function portfolioCompanionPosition(
  corner: PortfolioCompanionCorner,
  viewport: PortfolioCompanionViewport
): PortfolioCompanionPosition {
  return {
    x: corner.endsWith("right") ? viewport.width - PORTFOLIO_COMPANION_SIZE_PX - PORTFOLIO_COMPANION_MARGIN_PX : PORTFOLIO_COMPANION_MARGIN_PX,
    y: corner.startsWith("top") ? PORTFOLIO_COMPANION_MARGIN_PX : viewport.height - PORTFOLIO_COMPANION_SIZE_PX - PORTFOLIO_COMPANION_MARGIN_PX,
  };
}

/** Keeps the conversational surface next to its draggable companion and inside the viewport. */
export function portfolioCompanionChatPosition(
  anchor: PortfolioCompanionPosition,
  viewport: PortfolioCompanionViewport
): PortfolioCompanionChatPosition {
  const prefersLeft = anchor.x + PORTFOLIO_COMPANION_SIZE_PX / 2 >= viewport.width / 2;
  const desiredLeft = prefersLeft
    ? anchor.x - PORTFOLIO_COMPANION_CHAT_WIDTH_PX - PORTFOLIO_COMPANION_CHAT_GAP_PX
    : anchor.x + PORTFOLIO_COMPANION_SIZE_PX + PORTFOLIO_COMPANION_CHAT_GAP_PX;
  const desiredTop = anchor.y + PORTFOLIO_COMPANION_SIZE_PX - PORTFOLIO_COMPANION_CHAT_HEIGHT_PX;
  return {
    left: clampToViewport(desiredLeft, viewport.width, PORTFOLIO_COMPANION_CHAT_WIDTH_PX),
    top: clampToViewport(desiredTop, viewport.height, PORTFOLIO_COMPANION_CHAT_HEIGHT_PX),
  };
}

function clampToViewport(value: number, viewportSize: number, surfaceSize: number): number {
  const maximum = Math.max(PORTFOLIO_COMPANION_CHAT_SAFE_MARGIN_PX, viewportSize - surfaceSize - PORTFOLIO_COMPANION_CHAT_SAFE_MARGIN_PX);
  return Math.min(Math.max(value, PORTFOLIO_COMPANION_CHAT_SAFE_MARGIN_PX), maximum);
}
