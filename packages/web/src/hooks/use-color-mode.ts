import { useSyncExternalStore } from "react";

import {
  getColorModeState,
  subscribeToColorMode,
  type ColorModeState,
} from "@/lib/color-mode";

// Server snapshot matches the client default; the beforeInteractive script in
// the root layout is the only thing that runs before hydration.
const serverSnapshot: ColorModeState = { mode: "system", resolved: "dark" };

/**
 * Observe the app-wide color mode. Backed by a module-level store (see
 * `color-mode.ts`), so no provider wrapper is required. `mode` is the user's
 * stored preference, `resolved` the concrete light/dark value applied to
 * <html> (what live xterm instances should render with).
 */
export function useColorMode(): ColorModeState {
  return useSyncExternalStore(subscribeToColorMode, getColorModeState, () => serverSnapshot);
}
