// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DashboardPage from "./page";
import {
  discoverAdapters,
  getDashboardSummary,
  getDependencies,
  getProjectActivity,
  listProjects,
  listSessions,
} from "@/lib/api";
import { LanguageProvider } from "@/hooks/use-language";
import { ACTIVATION_DISMISSED_STORAGE_KEY } from "@/lib/activation-dismissal";

vi.mock("@/lib/gsap-motion", () => ({
  gsap: {
    from: vi.fn(),
    timeline: vi.fn(() => ({ from: vi.fn() })),
    matchMedia: vi.fn(() => ({ add: vi.fn(), revert: vi.fn() })),
  },
  matchMotionPreference: vi.fn(),
  useGSAP: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  discoverAdapters: vi.fn(),
  getDashboardSummary: vi.fn(),
  getDependencies: vi.fn(),
  getProjectActivity: vi.fn(),
  listProjects: vi.fn(),
  listSessions: vi.fn(),
}));

const summary = {
  stats: {
    projects: 1,
    sessions: 1,
    runningSessions: 0,
    skills: 0,
    models: 0,
    apiKeys: 0,
    templates: 0,
    acceptedDeliveries: 0,
  },
  health: {
    gateway: { healthy: true, message: "Ready" },
    database: { healthy: true, message: "Ready" },
    projectConfig: { healthy: true, message: "Ready" },
    models: { healthy: true, message: "Ready" },
    credentials: { healthy: true, message: "Ready" },
    sessions: { healthy: true, message: "Ready" },
    skills: { healthy: true, message: "Ready" },
  },
};

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={client}>
        <DashboardPage />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(getDashboardSummary).mockResolvedValue(summary);
  vi.mocked(getProjectActivity).mockResolvedValue({ series: [] });
  vi.mocked(listSessions).mockResolvedValue({ sessions: [] });
  vi.mocked(listProjects).mockResolvedValue({ projects: [{ id: "project-1", name: "Project", path: "/project" }] });
  vi.mocked(getDependencies).mockResolvedValue({
    dependencies: [],
    terminalRuntime: {
      persistence: "session-server",
      mode: "ready",
      supported: true,
      message: "Ready",
    },
  });
  vi.mocked(discoverAdapters).mockResolvedValue({
    adapters: [{
      id: "claude",
      label: "Claude Code",
      command: "claude",
      supportLevel: "supported",
      launchEnabled: true,
      configDir: ".claude",
      runtimeModes: ["terminal"],
      available: true,
      status: "available",
    }],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("does not flash quick start while readiness checks are loading", async () => {
  vi.mocked(getDependencies).mockReturnValue(new Promise(() => {}));
  renderDashboard();

  await waitFor(() => expect(getDependencies).toHaveBeenCalled());
  expect(screen.queryByText("快速上手")).toBeNull();
});

it("remembers completed readiness and stays hidden when later checks fail", async () => {
  const first = renderDashboard();
  await waitFor(() =>
    expect(window.localStorage.getItem(ACTIVATION_DISMISSED_STORAGE_KEY)).toBe("1"),
  );
  expect(screen.queryByText("快速上手")).toBeNull();
  first.unmount();

  vi.mocked(getDependencies).mockRejectedValue(new Error("Gateway unavailable"));
  vi.mocked(discoverAdapters).mockRejectedValue(new Error("Gateway unavailable"));
  renderDashboard();

  await waitFor(() => expect(discoverAdapters).toHaveBeenCalled());
  expect(screen.queryByText("快速上手")).toBeNull();
});
