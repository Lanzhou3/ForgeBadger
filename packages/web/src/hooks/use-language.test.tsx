// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider, useLanguage } from "./use-language";

function wrapper({ children }: { children: ReactNode }) {
  return <LanguageProvider>{children}</LanguageProvider>;
}

function stubBrowserLanguages(languages: string[]) {
  Object.defineProperty(window.navigator, "languages", {
    value: languages,
    configurable: true,
  });
}

describe("LanguageProvider browser preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = "";
    stubBrowserLanguages(["en-US"]);
  });

  it("restores the ForgeBadger language key on first read", async () => {
    window.localStorage.setItem("forgebadger-language", "en");

    const { result } = renderHook(() => useLanguage(), { wrapper });

    await waitFor(() => expect(result.current.language).toBe("en"));
    expect(window.localStorage.getItem("forgebadger-language")).toBe("en");
  });

  it("falls back to the browser locale when no preference is stored", async () => {
    stubBrowserLanguages(["zh-TW"]);

    const { result } = renderHook(() => useLanguage(), { wrapper });

    await waitFor(() => expect(result.current.language).toBe("zh-TW"));
    expect(document.documentElement.lang).toBe("zh-TW");
  });

  it("follows an English system locale for first-time visitors", async () => {
    stubBrowserLanguages(["en-US", "en"]);

    const { result } = renderHook(() => useLanguage(), { wrapper });

    await waitFor(() => expect(result.current.language).toBe("en"));
  });

  it("keeps Simplified Chinese for unsupported browser locales", async () => {
    stubBrowserLanguages(["fr-FR", "fr"]);

    const { result } = renderHook(() => useLanguage(), { wrapper });

    await waitFor(() => expect(document.documentElement.lang).toBe("zh-CN"));
    expect(result.current.language).toBe("zh-CN");
  });

  it("prefers a stored preference over the browser locale", async () => {
    stubBrowserLanguages(["en-US"]);
    window.localStorage.setItem("forgebadger-language", "zh-TW");

    const { result } = renderHook(() => useLanguage(), { wrapper });

    await waitFor(() => expect(result.current.language).toBe("zh-TW"));
  });
});

describe("LanguageProvider hydration consistency", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = "";
    stubBrowserLanguages(["en-US"]);
  });

  it("hydrates without warnings when the stored language differs from the server render", async () => {
    const Probe = () => {
      const { t } = useLanguage();
      return <p>{t("common.save")}</p>;
    };
    const element = (
      <LanguageProvider>
        <Probe />
      </LanguageProvider>
    );

    // Server pass: no storage on the server, so markup uses the default.
    const html = renderToString(element);
    expect(html).toContain("保存");

    // Client pass: the stored preference is English, but hydration must
    // accept the zh-CN server markup without mismatch warnings, then flip.
    window.localStorage.setItem("forgebadger-language", "en");
    const container = document.createElement("div");
    container.innerHTML = html;
    const messages: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      messages.push(args.map(String).join(" "));
    });
    const root = hydrateRoot(container, element);
    try {
      await waitFor(() => expect(container.textContent).toContain("Save"));
      const hydrationErrors = messages.filter((message) =>
        /did not match|hydration|hydrate/i.test(message)
      );
      expect(hydrationErrors).toEqual([]);
    } finally {
      spy.mockRestore();
      root.unmount();
      container.remove();
    }
  });

  it("keeps client-only renders on the detected language immediately", async () => {
    window.localStorage.setItem("forgebadger-language", "en");

    const { result } = renderHook(() => useLanguage(), { wrapper });

    // No hydration in jsdom renderHook, so the client snapshot wins at once.
    expect(result.current.language).toBe("en");
  });
});
