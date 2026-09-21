// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getTranslation } from "@/lib/i18n";
import { taskArtifactsApi } from "@/lib/project-task-api";
import { TaskCopilotArtifacts } from "./TaskCopilotArtifacts";
vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({
    t: (key: Parameters<typeof getTranslation>[1]) => getTranslation("en", key),
  }),
}));
const candidate = {
  developmentTaskId: "copilot",
  artifactDigest: "digest",
  status: "checks_passed",
  filesCount: 2,
  checksCount: 3,
  passedChecks: 3,
};
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(taskArtifactsApi, "list").mockResolvedValue({
    artifacts: [
      { ...candidate, id: "link", linkedAt: 1, current: false, canOpen: false },
    ],
    candidates: [candidate],
  });
});
afterEach(cleanup);
function mount(canLink = true) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TaskCopilotArtifacts
        projectId="p"
        taskId="t"
        revision={7}
        canLink={canLink}
      />
    </QueryClientProvider>,
  );
}
it("requires explicit summary sharing and sends the captured task revision and artifact digest", async () => {
  const link = vi
    .spyOn(taskArtifactsApi, "link")
    .mockRejectedValue(new Error("STALE_TASK_REVISION"));
  mount();
  await screen.findByText(/Historical summary/);
  expect(
    screen.queryByRole("link", { name: "Open your private Copilot task" }),
  ).toBeNull();
  fireEvent.change(screen.getByLabelText("Your completed Copilot artifact"), {
    target: { value: "copilot" },
  });
  expect(
    (screen.getByRole("button", { name: "Link summary" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByLabelText(
      "I agree to share this artifact summary with project members",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Link summary" }));
  await waitFor(() =>
    expect(link).toHaveBeenCalledWith("p", "t", {
      developmentTaskId: "copilot",
      artifactDigest: "digest",
      expectedTaskRevision: 7,
      shareSummary: true,
    }),
  );
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: /Accept|Merge/ })).toBeNull();
});
it("shows read-only summaries without association controls to a reviewer or management-only member", async () => {
  mount(false);
  await screen.findByText(/Historical summary/);
  expect(screen.queryByRole("button", { name: "Link summary" })).toBeNull();
});
