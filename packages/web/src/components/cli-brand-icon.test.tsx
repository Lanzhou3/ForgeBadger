// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { CliBrandIcon } from "./cli-brand-icon";

describe("CliBrandIcon", () => {
  it("renders an inline svg for each known CLI brand", () => {
    // Arrange & Act
    const rendered = ["claude", "codex", "kimi", "opencode"].map((aiTool) =>
      render(<CliBrandIcon aiTool={aiTool} />)
    );

    // Assert
    for (const view of rendered) {
      expect(view.container.querySelector("svg")).not.toBeNull();
    }
  });

  it("renders nothing for unknown or missing aiTool values", () => {
    // Arrange & Act
    const { container: unknownContainer } = render(<CliBrandIcon aiTool="other-cli" />);
    const { container: nullContainer } = render(<CliBrandIcon aiTool={null} />);
    const { container: undefinedContainer } = render(<CliBrandIcon />);

    // Assert
    for (const container of [unknownContainer, nullContainer, undefinedContainer]) {
      expect(container.querySelector("svg")).toBeNull();
    }
  });

  it("applies custom classes on top of the default sizing", () => {
    // Arrange & Act
    const { container } = render(<CliBrandIcon aiTool="claude" className="size-5" />);
    const svg = container.querySelector("svg");

    // Assert — tailwind-merge lets className override the default icon size.
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("class")).toContain("shrink-0");
    expect(svg?.getAttribute("class")).toContain("size-5");
    expect(svg?.getAttribute("class")).not.toContain("size-3.5");
  });
});
