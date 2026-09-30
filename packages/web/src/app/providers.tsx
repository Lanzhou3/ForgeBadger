"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { LanguageProvider } from "@/hooks/use-language";
import { NotificationProvider } from "@/hooks/use-notifications";
import { initColorMode } from "@/lib/color-mode";
import { initTerminalFont } from "@/lib/terminal-font";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  // Sync the color-mode store with localStorage/<html> and keep following the
  // OS while the stored mode is "system". Runs once for the whole app shell;
  // the returned cleanup tears down the matchMedia watcher on unmount.
  useEffect(() => initColorMode(), []);
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
