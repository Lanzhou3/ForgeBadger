// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { CliBrandIcon } from "./cli-brand-icon";

describe("CliBrandIcon", () => {
  it("renders inline svg marks for the other known CLI brands", () => {
    // Arrange & Act
    const rendered = ["claude", "kimi", "opencode", "pi", "mcode"].map((aiTool) =>
      render(<CliBrandIcon aiTool={aiTool} />)
    );

    // Assert
    for (const view of rendered) {
      expect(view.container.querySelector("svg")).not.toBeNull();
    }
  });

  it("renders the official MiniMax mark with a per-instance gradient id", () => {
    // Arrange
    const first = render(<CliBrandIcon aiTool="mcode" />);
    const second = render(<CliBrandIcon aiTool="mcode" />);

    // Act
    const ids = [first, second].map(
      (view) => view.container.querySelector("linearGradient")?.getAttribute("id")
    );
    const fills = [first, second].map(
      (view) => view.container.querySelector("path")?.getAttribute("fill")
    );

    // Assert — the mark is a gradient, so a static id would emit duplicate
    // <linearGradient> elements and url(#...) would resolve against whichever
    // the browser happened to find first.
    for (const id of ids) {
      expect(id).toBeTruthy();
      expect(id).not.toContain(":");
    }
    expect(new Set(ids).size).toBe(2);
    // Each path must reference its own gradient, not the sibling's.
    expect(fills[0]).toBe(`url(#${ids[0]})`);
    expect(fills[1]).toBe(`url(#${ids[1]})`);
  });

  it("renders the official Codex icon with a larger centered crop", () => {
    const { container } = render(<CliBrandIcon aiTool="codex" className="size-5" />);
    const icon = container.querySelector("img");
    const crop = icon?.parentElement;

    expect(icon?.getAttribute("src")).toBe("/brand/cli/codex.png");
    expect(icon?.getAttribute("class")).toContain("size-[150%]");
    expect(crop?.getAttribute("class")).toContain("size-5");
    expect(crop?.getAttribute("class")).toContain("overflow-hidden");
    expect(container.querySelector("svg")).toBeNull();
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
