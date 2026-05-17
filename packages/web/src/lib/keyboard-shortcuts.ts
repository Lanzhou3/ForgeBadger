export interface KeyLikeEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export interface GlobalShortcutContext {
  isTerminalRoute?: boolean;
  targetTagName?: string | null;
  targetIsContentEditable?: boolean;
  targetClosestXterm?: boolean;
}

export function isCommandPaletteShortcut(event: KeyLikeEvent): boolean {
  return hasPrimaryModifier(event) && !event.altKey && event.key.toLowerCase() === "k";
}

export function isSidebarToggleShortcut(event: KeyLikeEvent): boolean {
  return hasPrimaryModifier(event) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "b";
}

export function isCopilotShortcut(event: KeyLikeEvent): boolean {
  return hasPrimaryModifier(event) && !event.altKey && Boolean(event.shiftKey) && event.key.toLowerCase() === "k";
}

function hasPrimaryModifier(event: KeyLikeEvent): boolean {
  return Boolean(event.ctrlKey || event.metaKey);
}

export function shouldHandleGlobalShortcut(context: GlobalShortcutContext): boolean {
  if (context.isTerminalRoute || context.targetClosestXterm || context.targetIsContentEditable) {
    return false;
  }

  const tagName = context.targetTagName?.toLowerCase();
  return tagName !== "input" && tagName !== "textarea" && tagName !== "select";
}

export function shouldHandleCopilotShortcut(context: GlobalShortcutContext): boolean {
  if (context.targetClosestXterm || context.targetIsContentEditable) {
    return false;
  }

  const tagName = context.targetTagName?.toLowerCase();
  return tagName !== "input" && tagName !== "textarea" && tagName !== "select";
}

export function globalShortcutContextFromEvent(
  event: Pick<KeyboardEvent, "target">,
  options: { isTerminalRoute?: boolean } = {}
): GlobalShortcutContext {
  const target = event.target instanceof Element ? event.target : null;
  return {
    isTerminalRoute: options.isTerminalRoute,
    targetTagName: target?.tagName,
    targetIsContentEditable: target instanceof HTMLElement ? target.isContentEditable : false,
    targetClosestXterm: Boolean(target?.closest(".xterm")),
  };
}
