// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { LanguageProvider, useLanguage } from "./use-language";

function wrapper({ children }: { children: ReactNode }) {
  return <LanguageProvider>{children}</LanguageProvider>;
}

describe("LanguageProvider browser preference", () => {
  beforeEach(() => window.localStorage.clear());

  it("restores the ForgeBadger language key on first read", async () => {
    window.localStorage.setItem("forgebadger-language", "en");

    const { result } = renderHook(() => useLanguage(), { wrapper });

    await waitFor(() => expect(result.current.language).toBe("en"));
    expect(window.localStorage.getItem("forgebadger-language")).toBe("en");
  });
});
