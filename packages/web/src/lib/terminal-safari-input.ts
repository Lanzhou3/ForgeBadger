import type { Terminal } from "@xterm/xterm";

/** xterm 5.5's input de-duplication state; optional to fail open on upgrades. */
interface XtermInputState {
  _core?: {
    _keyDownSeen?: boolean;
    _keyPressHandled?: boolean;
  };
}

/**
 * Safari IMEs can commit text before its character keydown. A preceding Shift
 * or CapsLock keydown then makes xterm 5.5 discard it as duplicate input.
 * https://github.com/xtermjs/xterm.js/issues/5374
 * Release only that stale modifier state; let xterm deliver the text normally.
 */
export function installSafariTerminalInputFix(terminal: Terminal): () => void {
  const textarea = terminal.textarea;
  const userAgent = navigator.userAgent;
  const isMacSafari = /Macintosh/.test(userAgent) && /AppleWebKit/.test(userAgent)
    && /Safari\//.test(userAgent) && !/Chrome|Chromium|Edg|OPR|CriOS|FxiOS/.test(userAgent);
  if (!textarea || !isMacSafari) return () => {};

  let modifierPending = false;
  let composing = false;
  const reset = () => { modifierPending = false; };
  const onKeyDown = (event: KeyboardEvent) => {
    modifierPending = (event.key === "Shift" || event.key === "CapsLock")
      && !event.ctrlKey && !event.altKey && !event.metaKey;
  };
  const onCompositionStart = () => { composing = true; reset(); };
  const onCompositionEnd = () => { composing = false; reset(); };
  const onBeforeInput = (event: InputEvent) => {
    if (!modifierPending || composing || event.isComposing || !event.composed
      || event.inputType !== "insertText" || !event.data || terminal.options.screenReaderMode) return;
    const core = (terminal as Terminal & XtermInputState)._core;
    if (core?._keyDownSeen === true && core._keyPressHandled === false) {
      core._keyDownSeen = false;
    }
    reset();
  };

  textarea.addEventListener("keydown", onKeyDown, true);
  textarea.addEventListener("keyup", reset, true);
  textarea.addEventListener("blur", reset);
  textarea.addEventListener("compositionstart", onCompositionStart);
  textarea.addEventListener("compositionend", onCompositionEnd);
  textarea.addEventListener("beforeinput", onBeforeInput);
  return () => {
    textarea.removeEventListener("keydown", onKeyDown, true);
    textarea.removeEventListener("keyup", reset, true);
    textarea.removeEventListener("blur", reset);
    textarea.removeEventListener("compositionstart", onCompositionStart);
    textarea.removeEventListener("compositionend", onCompositionEnd);
    textarea.removeEventListener("beforeinput", onBeforeInput);
  };
}
