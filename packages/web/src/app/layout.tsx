import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { Providers } from "./providers";

import "@xterm/xterm/css/xterm.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenForge",
  description: "AI programming IDE control platform"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <Script src="/openforge-runtime.js" strategy="beforeInteractive" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
