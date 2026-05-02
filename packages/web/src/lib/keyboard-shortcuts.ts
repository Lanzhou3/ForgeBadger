export interface KeyLikeEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export function isCommandPaletteShortcut(event: KeyLikeEvent): boolean {
  return hasPrimaryModifier(event) && !event.altKey && event.key.toLowerCase() === "k";
}

export function isSidebarToggleShortcut(event: KeyLikeEvent): boolean {
  return hasPrimaryModifier(event) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "b";
}

function hasPrimaryModifier(event: KeyLikeEvent): boolean {
  return Boolean(event.ctrlKey || event.metaKey);
}
