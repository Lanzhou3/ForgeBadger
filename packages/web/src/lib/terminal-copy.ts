export interface TerminalSelection {
  getSelection(): string;
  hasSelection(): boolean;
}

interface TerminalBufferTextSource {
  cols: number;
  buffer: { active: {
    length: number;
    getLine(index: number): { isWrapped: boolean; translateToString(trimRight?: boolean, start?: number, end?: number): string } | undefined;
  } };
}

/** Read the active screen and scrollback without temporarily changing selection. */
export function getTerminalBufferText(terminal: TerminalBufferTextSource): string {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let index = 0; index < buffer.length; index++) {
    const line = buffer.getLine(index);
    if (!line) continue;
    // xterm trims unused cells, preserving actual printed spaces. This also
    // omits the padding left when a wide character wraps from the last column.
    const text = line.translateToString(true, 0, terminal.cols);
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  // The unused blank rows at the bottom of a terminal are not output.
  return lines.join("\n").replace(/\n+$/, "");
}

export function shouldCopyTerminalSelection(event: KeyboardEvent, hasSelection: boolean): boolean {
  if (!hasSelection) return false;

  const isCopyKey = event.key.toLowerCase() === "c";
  const hasPlatformModifier = event.ctrlKey || event.metaKey;
  const hasExtraModifier = event.altKey || event.shiftKey;

  return isCopyKey && hasPlatformModifier && !hasExtraModifier;
}

export async function copySelectedTerminalText(
  terminal: TerminalSelection,
  clipboard: Pick<Clipboard, "writeText"> | undefined = globalThis.navigator?.clipboard
): Promise<boolean> {
  return copyTerminalText(terminal.getSelection(), clipboard);
}

export async function copyTerminalText(
  text: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined = globalThis.navigator?.clipboard
): Promise<boolean> {
  if (!text) return false;

  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Some browsers expose the API but deny access; try the user-gesture fallback.
    }
  }

  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;

  const previousFocus = document.activeElement;
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  try {
    document.body.appendChild(textArea);
    textArea.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textArea.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
  }
}
