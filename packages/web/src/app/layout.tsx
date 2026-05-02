import type { Metadata } from "next";
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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
