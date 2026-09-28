import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { Providers } from "./providers";

import "@xterm/xterm/css/xterm.css";
import "./globals.css";

// Absolute URL of the canonical banner asset: link unfurlers cannot reach the
// locally hosted `/brand/*` files, so share cards point at the raw GitHub copy.
const brandBannerUrl =
  "https://raw.githubusercontent.com/Lanzhou3/ForgeBadger/main/packages/web/public/brand/forgebadger-banner.png";
const brandDescription = "Local-first AI programming IDE control platform";

export const metadata: Metadata = {
  title: "ForgeBadger",
  description: brandDescription,
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/brand/forgebadger-logo.png",
  },
  openGraph: {
    title: "ForgeBadger",
    description: brandDescription,
    type: "website",
    images: [{ url: brandBannerUrl, width: 1774, height: 887, alt: "ForgeBadger" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ForgeBadger",
    description: brandDescription,
    images: [brandBannerUrl],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        <Script src="/forgebadger-runtime.js" strategy="beforeInteractive" />
        {/* Restore the accent theme before first paint to avoid a color flash. */}
        <Script id="accent-theme" strategy="beforeInteractive">
          {`try{var a=localStorage.getItem("forgebadger.accent");if(a)document.documentElement.dataset.accent=a;}catch(e){}`}
        </Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
