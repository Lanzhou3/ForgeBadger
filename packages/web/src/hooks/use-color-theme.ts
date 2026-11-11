import { useSyncExternalStore } from "react";

import {
  getColorThemeState,
  subscribeToColorThemes,
  type ColorThemeState,
} from "@/lib/color-theme";

const serverSnapshot: ColorThemeState = { dark: "one-dark", light: "github-light" };

export function useColorTheme(): ColorThemeState {
  return useSyncExternalStore(subscribeToColorThemes, getColorThemeState, () => serverSnapshot);
}
