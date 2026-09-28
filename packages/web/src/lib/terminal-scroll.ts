/**
 * Decides what a wheel event should do on a terminal buffer.
 *
 * Full-screen TUIs (Claude Code, Kimi Code) switch to the alternate screen
 * (`ESC[?1049h`) and explicitly disable mouse reporting. In that state xterm's
 * alternateScroll converts wheel events into arrow-key sequences (up/down),
 * which pollutes the app's input history. When the app has mouse reporting
 * active (OpenCode), the wheel is delivered as SGR mouse events and must pass
 * through untouched; on the normal buffer, xterm scrolls its own scrollback.
 *
 * Only "alternate screen AND mouse events inactive" should be suppressed.
 */
export function resolveWheelAction(
  bufferType: "normal" | "alternate",
  mouseEventsActive: boolean
): "allow" | "suppress" {
  if (bufferType === "alternate" && !mouseEventsActive) {
    return "suppress";
  }
  return "allow";
}
