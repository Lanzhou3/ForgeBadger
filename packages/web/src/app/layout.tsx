import type { Metadata, Viewport } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import { APPEARANCE_INIT_SCRIPT } from "@/lib/appearance-init";

import "@xterm/xterm/css/xterm.css";
import "./globals.css";

// Absolute URL of the canonical banner asset: link unfurlers cannot reach the
// locally hosted `/brand/*` files, so share cards point at the raw GitHub copy.
const brandBannerUrl =
  "https://raw.githubusercontent.com/Lanzhou3/ForgeBadger/main/packages/web/public/brand/forgebadger-banner.png";
const brandDescription = "Local-first workspace for your AI coding tools";

export const viewport: Viewport = { colorScheme: "light dark" };

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
    // Server markup and the first client render both use the default language
    // (zh-CN); LanguageProvider updates document.documentElement.lang after
    // hydration once the stored/system preference is known.
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <Script src="/forgebadger-runtime.js" strategy="beforeInteractive" />
        <Script id="appearance-theme" strategy="beforeInteractive">
          {APPEARANCE_INIT_SCRIPT}
        </Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
