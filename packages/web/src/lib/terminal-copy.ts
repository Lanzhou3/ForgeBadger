export interface TerminalSelection {
  getSelection(): string;
  hasSelection(): boolean;
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
  const selection = terminal.getSelection();
  if (!selection) return false;

  if (clipboard?.writeText) {
    await clipboard.writeText(selection);
    return true;
  }

  if (typeof document === "undefined") return false;

  const textArea = document.createElement("textarea");
  textArea.value = selection;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textArea);
  }
}
