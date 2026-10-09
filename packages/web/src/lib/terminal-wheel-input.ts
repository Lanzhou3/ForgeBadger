/**
 * SGR mouse wheel reports: `CSI < button ; col ; row M|m`. The button field
 * encodes the wheel as base 64 (up) / 65 (down) plus modifier bits
 * (shift=4, alt=8, ctrl=16) → 64, 65, 68, 69, 72, 73, 80, 81.
 *
 * Used to distinguish a scroll gesture from a keystroke: while the copilot
 * holds the writer lease the web terminal must stay read-only for keys and
 * clicks, but SGR wheel reports still have to reach the app so a fullscreen
 * TUI's (pi, opencode, codex) viewport can be scrolled while watching.
 */
const WHEEL_REPORT_PATTERN = /^(?:\x1b\[<(?:64|65|68|69|72|73|80|81);\d+;\d+[Mm])+$/;

/** True when the data chunk contains nothing but SGR mouse wheel reports. */
export function isTerminalWheelInput(data: string): boolean {
  return data.length > 0 && WHEEL_REPORT_PATTERN.test(data);
}
