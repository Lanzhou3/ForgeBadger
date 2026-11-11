// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ProjectActivityCard, buildProjectActivityRows } from "./project-activity-card";
import { getProjectActivity } from "@/lib/api";
import { LanguageProvider } from "@/hooks/use-language";

vi.mock("@/lib/gsap-motion", () => ({
  gsap: { from: vi.fn() },
  matchMotionPreference: vi.fn(),
  useGSAP: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getProjectActivity: vi.fn(),
}));

function dayOffset(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function point(group: string, day: string, totalTokens: number) {
  return { group, day, totalTokens, inputTokens: 0, outputTokens: totalTokens };
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={client}>
        <ProjectActivityCard projects={[{ id: "alpha-id", name: "Alpha", path: "/work/alpha" }]} />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  window.localStorage.setItem("forgebadger-language", "zh-CN");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("ranks recent active projects and limits the compact view to five", () => {
  const days = [dayOffset(2), dayOffset(1), dayOffset(0)];
  const series = Array.from({ length: 6 }, (_, index) => point(`project-${index}`, dayOffset(0), index + 1));
  const rows = buildProjectActivityRows(series, days, []);

  expect(rows).toHaveLength(5);
  expect(rows.map((row) => row.group)).toEqual([
    "project-5", "project-4", "project-3", "project-2", "project-1",
  ]);
});

it("uses project-relative intensity and links projects and days to their destinations", async () => {
  vi.mocked(getProjectActivity).mockResolvedValue({
    series: [
      point("/work/alpha", dayOffset(1), 100),
      point("/work/alpha", dayOffset(0), 1000),
      point("small", dayOffset(0), 10),
    ],
  });
  renderCard();

  expect((await screen.findByRole("link", { name: "Alpha" })).getAttribute("href")).toBe("/projects/alpha-id");
  const peak = await screen.findByTestId(`dashboard-activity-/work/alpha-${dayOffset(0)}`);
  const quieter = screen.getByTestId(`dashboard-activity-/work/alpha-${dayOffset(1)}`);
  const smallProjectPeak = screen.getByTestId(`dashboard-activity-small-${dayOffset(0)}`);
  expect(peak.className).toContain("bg-brand");
  expect(quieter.className).not.toContain("bg-brand ");
  expect(smallProjectPeak.className).toContain("bg-brand");
  expect(peak.getAttribute("href")).toBe(
    `/usage?range=last30&project=${encodeURIComponent("/work/alpha")}&day=${dayOffset(0)}`,
  );
  expect(screen.queryByText("project-6")).toBeNull();
});

it("hides when there is no activity and offers retry on failure", async () => {
  vi.mocked(getProjectActivity).mockResolvedValueOnce({ series: [] });
  const first = renderCard();
  await waitFor(() => expect(getProjectActivity).toHaveBeenCalled());
  await waitFor(() => expect(first.container.childElementCount).toBe(0));
  first.unmount();

  vi.mocked(getProjectActivity)
    .mockRejectedValueOnce(new Error("unavailable"))
    .mockResolvedValueOnce({ series: [point("alpha", dayOffset(0), 10)] });
  renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "重试" }));
  expect(await screen.findByTestId(`dashboard-activity-alpha-${dayOffset(0)}`)).toBeTruthy();
});
