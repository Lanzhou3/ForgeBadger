// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { QueryState } from "./query-state";

function renderState(props: Partial<Parameters<typeof QueryState>[0]>) {
  return render(
    <LanguageProvider>
      <QueryState
        isLoading={false}
        isError={false}
        isEmpty={false}
        empty={<div>empty-copy</div>}
        {...props}
      >
        <div>content-copy</div>
      </QueryState>
    </LanguageProvider>
  );
}

describe("QueryState", () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.setItem("forgebadger-language", "zh-CN");
  });

  it("renders the loading placeholder while loading", () => {
    renderState({ isLoading: true, loading: <div>loading-copy</div> });
    expect(screen.getByText("loading-copy")).toBeTruthy();
    expect(screen.queryByText("empty-copy")).toBeNull();
    expect(screen.queryByText("content-copy")).toBeNull();
  });

  it("falls back to the default spinner loading line when no placeholder is given", () => {
    renderState({ isLoading: true });
    expect(screen.getByText("加载中…")).toBeTruthy();
    expect(screen.queryByText("content-copy")).toBeNull();
  });

  it("renders the error state with a retry button instead of the empty state", () => {
    const onRetry = vi.fn();
    renderState({ isError: true, onRetry });
    expect(screen.getByText("加载失败")).toBeTruthy();
    expect(screen.queryByText("empty-copy")).toBeNull();
    expect(screen.queryByText("content-copy")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("honours a custom error state when provided", () => {
    renderState({ isError: true, error: <div>custom-error</div> });
    expect(screen.getByText("custom-error")).toBeTruthy();
    expect(screen.queryByText("加载失败")).toBeNull();
  });

  it("renders the empty state only when the query succeeded with no data", () => {
    renderState({ isEmpty: true });
    expect(screen.getByText("empty-copy")).toBeTruthy();
    expect(screen.queryByText("content-copy")).toBeNull();
  });

  it("renders children only when the query succeeded with data", () => {
    renderState({});
    expect(screen.getByText("content-copy")).toBeTruthy();
    expect(screen.queryByText("empty-copy")).toBeNull();
  });
});
