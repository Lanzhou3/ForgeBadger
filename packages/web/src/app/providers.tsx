"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { LanguageProvider } from "@/hooks/use-language";
import { NotificationProvider } from "@/hooks/use-notifications";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <NotificationProvider>{children}</NotificationProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}
