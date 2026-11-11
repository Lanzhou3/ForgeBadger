"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { LanguageProvider } from "@/hooks/use-language";
import { NotificationProvider } from "@/hooks/use-notifications";
import { initColorMode } from "@/lib/color-mode";
import { initColorThemes } from "@/lib/color-theme";
import { initTerminalFont } from "@/lib/terminal-font";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  // Restore independent dark/light palettes before subscribing to OS changes.
  useEffect(() => {
    initColorThemes();
    return initColorMode();
  }, []);
  // Sync the terminal-font store with localStorage so xterm instances created
  // after mount pick up the persisted preference.
  useEffect(() => initTerminalFont(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <NotificationProvider>{children}</NotificationProvider>
        <Toaster position="top-right" />
      </LanguageProvider>
    </QueryClientProvider>
  );
}
