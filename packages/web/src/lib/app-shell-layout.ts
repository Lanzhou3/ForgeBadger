export const appShellContainerClassName =
  "flex h-dvh w-full overflow-hidden bg-background text-foreground";

export function appShellMainClassName(isTerminalRoute: boolean): string {
  return isTerminalRoute
    ? "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    : // Mobile reserves top space for the fixed hamburger trigger; desktop
      // pages keep their own padding.
    "h-full min-h-0 min-w-0 flex-1 overflow-auto pt-16 md:pt-0";
}
