import { describe, expect, it } from "vitest";

import { buildAgentPermissionPreview, splitCommaList } from "./agent-preview";

describe("agent preview helpers", () => {
  it("normalizes comma and newline separated permission lists", () => {
    expect(splitCommaList("Read, Edit\nBash")).toEqual(["Read", "Edit", "Bash"]);
  });

  it("builds a permission preview for form values", () => {
    const preview = buildAgentPermissionPreview({
      tools: "Read,Edit",
      allowedDirs: "/path/to/project\n/tmp/project",
      projectName: "OpenForge",
      modelName: "Claude Sonnet",
    });

    expect(preview.tools).toEqual(["Read", "Edit"]);
    expect(preview.allowedDirs).toEqual(["/path/to/project", "/tmp/project"]);
    expect(preview.scope).toBe("OpenForge");
    expect(preview.model).toBe("Claude Sonnet");
  });
});
