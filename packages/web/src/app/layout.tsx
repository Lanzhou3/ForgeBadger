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
const brandDescription = "Local-first workspace for your AI coding tools";

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
          {`try{var r=document.documentElement;var m=localStorage.getItem("forgebadger.color-mode");var d=m==="dark"||(m!=="light"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);var dt=localStorage.getItem("forgebadger.dark-theme");var lt=localStorage.getItem("forgebadger.light-theme");r.dataset.darkTheme=dt==="tokyo-night"?"tokyo-night":"one-dark";r.dataset.lightTheme=lt==="solarized-light"?"solarized-light":"github-light";if(d){r.classList.add("dark");r.style.colorScheme="dark";}else{r.style.colorScheme="light";}}catch(e){}`}
        </Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
