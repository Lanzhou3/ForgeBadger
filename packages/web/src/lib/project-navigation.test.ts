import { describe, it, expect } from "vitest";
import { developmentTaskHref } from "./project-navigation";
describe("unified task navigation", () => {
  it("preserves task selection in the project's only task panel", () => {
    expect(developmentTaskHref("project", "task")).toBe(
      "/projects/project?tab=project-manager&workItemId=task",
    );
    expect(developmentTaskHref("one/two")).toBe(
      "/projects/one%2Ftwo?tab=project-manager",
    );
  });
});
