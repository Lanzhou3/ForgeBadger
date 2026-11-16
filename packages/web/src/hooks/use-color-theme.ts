import { useSyncExternalStore } from "react";

import {
  getColorThemeState,
  DEFAULT_COLOR_THEMES,
  subscribeToColorThemes,
  type ColorThemeState,
} from "@/lib/color-theme";

const serverSnapshot: ColorThemeState = { ...DEFAULT_COLOR_THEMES };

export function useColorTheme(): ColorThemeState {
  return useSyncExternalStore(subscribeToColorThemes, getColorThemeState, () => serverSnapshot);
}
