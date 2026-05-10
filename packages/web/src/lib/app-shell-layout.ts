export const appShellContainerClassName =
  "flex h-dvh w-full overflow-hidden bg-background text-foreground";

export function appShellMainClassName(isTerminalRoute: boolean): string {
  return isTerminalRoute
    ? "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    : "h-full min-h-0 min-w-0 flex-1 overflow-auto";
}
