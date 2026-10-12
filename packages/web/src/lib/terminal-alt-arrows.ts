type ArrowKeyEvent = Pick<KeyboardEvent,
  "type" | "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "isComposing"
>;

/**
 * xterm 5.5 mistakes Next's browser process shim for Node and loses isMac.
 * Its non-Mac compatibility rule then turns Option+Up/Down into Ctrl+Up/Down.
 * Preserve these macOS shortcuts using xterm's public input API instead.
 */
export function terminalAltArrowInput(event: ArrowKeyEvent, platform: string): string | null {
  if (!/^(Macintosh|MacIntel|MacPPC|Mac68K)$/.test(platform)
    || event.type !== "keydown" || event.isComposing
    || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.key === "ArrowUp") return "\x1b[1;3A";
  if (event.key === "ArrowDown") return "\x1b[1;3B";
  return null;
}
