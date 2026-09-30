// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

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
