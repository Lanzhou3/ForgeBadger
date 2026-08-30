import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { Providers } from "./providers";

import "@xterm/xterm/css/xterm.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "ForgeBadger",
  description: "Local-first AI programming IDE control platform",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/brand/forgebadger-logo.png",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        <Script src="/forgebadger-runtime.js" strategy="beforeInteractive" />
        {/* Restore the accent theme before first paint to avoid a color flash. */}
        <Script id="accent-theme" strategy="beforeInteractive">
          {`try{var k="forgebadger.accent",o="openforge.accent",a=localStorage.getItem(k);if(a!==null){localStorage.removeItem(o);}else{a=localStorage.getItem(o);if(a!==null){localStorage.setItem(k,a);localStorage.removeItem(o);}}if(a)document.documentElement.dataset.accent=a;}catch(e){}`}
        </Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
