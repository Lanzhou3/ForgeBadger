// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTranslation } from "@/lib/i18n";
import { hubInsightsApi, type HubInsightCheck, type HubInsights } from "@/lib/hub-insights-api";
import { HubInsightsPanel } from "./HubInsightsPanel";
import { TaskHubInsights } from "./TaskHubInsights";

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ language: "en", t: (key: Parameters<typeof getTranslation>[1]) => getTranslation("en", key) }),
  useUiLocale: () => "en-US",
}));

const en = (key: Parameters<typeof getTranslation>[1]) => getTranslation("en", key);

function check(kind: HubInsightCheck["kind"], status: HubInsightCheck["status"], details: Record<string, unknown>): HubInsightCheck {
  return { submissionId: "sub", taskId: "task", kind, status, details, checkedAt: 1 };
}

function insights(overrides: Partial<HubInsights> = {}): HubInsights {
  return {
    modules: [{ pattern: "packages/web/", owners: ["@alice"] }, { pattern: "packages/gateway/", owners: [] }],
    taskModules: {},
    checks: [],
    sync: { mirrorFetchedAt: null, mirrorError: null, remotePolledAt: null, remoteError: null },
    remote: { tokenConfigured: false },
    ...overrides,
  };
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(cleanup);

describe("HubInsightsPanel", () => {
  it("hides refresh buttons from a plain reader", async () => {
    vi.spyOn(hubInsightsApi, "insights").mockResolvedValue(insights());
    wrap(<HubInsightsPanel projectId="p" canManage={false} canReview={false} />);
    await screen.findByText(en("hubInsights.radar"));
    expect(screen.queryByRole("button", { name: en("hubInsights.refreshMirror") })).toBeNull();
    expect(screen.queryByRole("button", { name: en("hubInsights.refreshRemote") })).toBeNull();
    expect(screen.queryByText(en("hubInsights.tokenTitle"))).toBeNull();
  });

  it("lets a reviewer refresh the radar and the remote status", async () => {
    vi.spyOn(hubInsightsApi, "insights").mockResolvedValue(insights());
    const mirror = vi.spyOn(hubInsightsApi, "refreshMirror").mockResolvedValue(insights());
    const remote = vi.spyOn(hubInsightsApi, "refreshRemote").mockResolvedValue({ checks: [] });
    wrap(<HubInsightsPanel projectId="p" canManage={false} canReview />);
    fireEvent.click(await screen.findByRole("button", { name: en("hubInsights.refreshMirror") }));
    await waitFor(() => expect(mirror).toHaveBeenCalledWith("p"));
    fireEvent.click(screen.getByRole("button", { name: en("hubInsights.refreshRemote") }));
    await waitFor(() => expect(remote).toHaveBeenCalledWith("p"));
  });

  it("shows sync errors translated, and the attention summary", async () => {
    vi.spyOn(hubInsightsApi, "insights").mockResolvedValue(insights({
      sync: { mirrorFetchedAt: null, mirrorError: "MIRROR_FETCH_FAILED", remotePolledAt: null, remoteError: null },
      checks: [check("base_conflict", "attention", { files: ["a"] }), check("ci", "ok", {})],
    }));
    wrap(<HubInsightsPanel projectId="p" canManage={false} canReview={false} />);
    expect(await screen.findByText(en("hubInsights.err.MIRROR_FETCH_FAILED"))).toBeTruthy();
    expect(screen.getByText(`${en("hubInsights.kind.base_conflict")} 1`, { exact: false })).toBeTruthy();
  });

  it("lists modules and explains the empty state", async () => {
    const spy = vi.spyOn(hubInsightsApi, "insights").mockResolvedValue(insights());
    wrap(<HubInsightsPanel projectId="p" canManage={false} canReview={false} />);
    expect(await screen.findByText("packages/web/")).toBeTruthy();
    expect(screen.getByText(/@alice/)).toBeTruthy();
    cleanup();
    spy.mockResolvedValue(insights({ modules: [] }));
    wrap(<HubInsightsPanel projectId="p" canManage={false} canReview={false} />);
    expect(await screen.findByText(en("hubInsights.modulesEmpty"))).toBeTruthy();
  });

  it("saves the token only for managers, clears the input and never renders it back", async () => {
    vi.spyOn(hubInsightsApi, "insights").mockResolvedValue(insights({ remote: { tokenConfigured: true } }));
    const put = vi.spyOn(hubInsightsApi, "putCredential").mockResolvedValue({ tokenConfigured: true });
    wrap(<HubInsightsPanel projectId="p" canManage canReview={false} />);
    const input = await screen.findByLabelText(en("hubInsights.tokenLabel")) as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.change(input, { target: { value: "ghp_secret" } });
    fireEvent.click(screen.getByRole("button", { name: en("hubInsights.tokenSave") }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("p", "ghp_secret"));
    await waitFor(() => expect(input.value).toBe(""));
    expect(document.body.textContent).not.toContain("ghp_secret");
  });

  it("removes the token with DELETE", async () => {
    vi.spyOn(hubInsightsApi, "insights").mockResolvedValue(insights({ remote: { tokenConfigured: true } }));
    const del = vi.spyOn(hubInsightsApi, "deleteCredential").mockResolvedValue({ tokenConfigured: false });
    wrap(<HubInsightsPanel projectId="p" canManage canReview={false} />);
    fireEvent.click(await screen.findByRole("button", { name: en("hubInsights.tokenRemove") }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("p"));
  });
});

describe("TaskHubInsights", () => {
  function renderTask(checks: HubInsightCheck[], canManage = false, taskModules: Record<string, string> = {}) {
    vi.spyOn(hubInsightsApi, "insights").mockResolvedValue(insights({ checks, taskModules }));
    return wrap(<TaskHubInsights projectId="p" taskId="task" submissionId="sub" canManage={canManage} />);
  }

  it("shows attention badges with file lists and a +N more counter", async () => {
    const files = Array.from({ length: 7 }, (_, index) => `src/file${index}.ts`);
    renderTask([check("base_conflict", "attention", { baseBranch: "main", files, truncated: false })]);
    expect(await screen.findByText("src/file4.ts")).toBeTruthy();
    expect(screen.queryByText("src/file5.ts")).toBeNull();
    expect(screen.getByText(`+2 ${en("hubInsights.more")}`)).toBeTruthy();
  });

  it("shortens peer task ids and shows outside-module files", async () => {
    renderTask([
      check("peer_conflict", "attention", { peers: [{ submissionId: "s2", taskId: "abcdefghijklmnop", files: ["x", "y"] }] }),
      check("scope", "attention", { pattern: "packages/web/", outside: ["README.md"], total: 1 }),
    ]);
    expect(await screen.findByText("abcdefgh")).toBeTruthy();
    expect(screen.getByText("README.md")).toBeTruthy();
  });

  it("links only safe pull request URLs and warns when the PR does not match", async () => {
    const pr = (url: string) => check("pull_request", "attention", { number: 7, url, state: "open", draft: true, headSha: "a", matchesSubmission: false });
    renderTask([pr("https://github.com/acme/repo/pull/7")]);
    const link = await screen.findByRole("link", { name: en("hubInsights.prLink") });
    expect(link.getAttribute("href")).toBe("https://github.com/acme/repo/pull/7");
    expect(screen.getByText(en("hubInsights.prMismatch"))).toBeTruthy();
    expect(screen.getByText(en("hubInsights.prDraft"))).toBeTruthy();
    cleanup();
    renderTask([pr("javascript:alert(1)")]);
    await screen.findByText(en("hubInsights.kind.pull_request"));
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows CI failed over total", async () => {
    renderTask([check("ci", "attention", { state: "failure", total: 5, failed: 2 })]);
    expect(await screen.findByText(new RegExp(`${en("hubInsights.ciFailure")} · 2/5`))).toBeTruthy();
  });

  it("translates COMMIT_NOT_FETCHED for unknown checks and falls back otherwise", async () => {
    renderTask([check("base_conflict", "unknown", { reason: "COMMIT_NOT_FETCHED" }), check("ci", "unknown", { reason: "weird" })]);
    expect(await screen.findByText(en("hubInsights.reason.COMMIT_NOT_FETCHED"))).toBeTruthy();
    expect(screen.getByText(en("hubInsights.reason.unknown"))).toBeTruthy();
  });

  it("does not crash on malformed details", async () => {
    renderTask([
      check("base_conflict", "attention", { files: "nope" }),
      check("peer_conflict", "attention", { peers: [null, 3, { taskId: 5 }] }),
      check("scope", "attention", { outside: { a: 1 } }),
      check("pull_request", "ok", { url: 42, state: "bogus" }),
      check("ci", "ok", { state: 7 }),
    ]);
    expect(await screen.findByText(en("hubInsights.kind.ci"))).toBeTruthy();
  });

  it("shows the module read-only for non-managers", async () => {
    renderTask([], false, { task: "packages/web/" });
    expect(await screen.findByText("packages/web/")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("lets a manager choose a module and clear it", async () => {
    const set = vi.spyOn(hubInsightsApi, "setTaskModule").mockResolvedValue({ taskModules: {} });
    renderTask([], true);
    const select = await screen.findByRole("combobox");
    fireEvent.change(select, { target: { value: "packages/gateway/" } });
    await waitFor(() => expect(set).toHaveBeenCalledWith("p", "task", "packages/gateway/"));
    cleanup();
    renderTask([], true, { task: "packages/web/" });
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "" } });
    await waitFor(() => expect(set).toHaveBeenCalledWith("p", "task", null));
  });

  it("renders nothing when the insights request fails", async () => {
    vi.spyOn(hubInsightsApi, "insights").mockRejectedValue(new Error("PROJECT_CAPABILITY_DENIED"));
    const { container } = wrap(<TaskHubInsights projectId="p" taskId="task" submissionId="sub" canManage={false} />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(container.textContent).toBe("");
  });
});
