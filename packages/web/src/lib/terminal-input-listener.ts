export interface DisposableInputListener {
  dispose(): void;
}

export function replaceTerminalInputListener(
  ref: { current: DisposableInputListener | null },
  next: DisposableInputListener | null
): void {
  ref.current?.dispose();
  ref.current = next;
}
