// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { CliBrandIcon } from "./cli-brand-icon";

describe("CliBrandIcon", () => {
  it("renders inline svg marks for the other known CLI brands", () => {
    // Arrange & Act
    const rendered = ["claude", "kimi", "opencode", "pi", "mcode", "terminal"].map((aiTool) =>
      render(<CliBrandIcon aiTool={aiTool} />)
    );

    // Assert
    for (const view of rendered) {
      expect(view.container.querySelector("svg")).not.toBeNull();
    }
  });

  it("adds the official black tile behind the Kimi mark in light mode", () => {
    // Arrange & Act
    const { container } = render(<CliBrandIcon aiTool="kimi" />);

    // Assert — the official app icon (kimi.moonshot.cn favicon) sits the white
    // K + blue dot on a black rounded tile; without the tile the white K is
    // invisible on light surfaces. The tile hides in dark mode, where the bare
    // white K matches the official favicon-dark variant.
    const tile = container.querySelector("rect");
    expect(tile?.getAttribute("fill")).toBe("#000000");
    expect(tile?.getAttribute("rx")).toBe("5");
    expect(tile?.getAttribute("class")).toContain("dark:hidden");
    const group = container.querySelector("g");
    const groupClass = group?.getAttribute("class") ?? "";
    expect(groupClass).toContain("scale-[0.9]");
    expect(groupClass).toContain("dark:scale-100");
    const fills = Array.from(container.querySelectorAll("path")).map((p) =>
      p.getAttribute("fill")
    );
    expect(fills).toEqual(["#1783FF", "#FFFFFF"]);
  });

  it("renders the official MiniMax Code app icon (blue tile + white card + black frame)", () => {
    // Arrange & Act
    const { container } = render(<CliBrandIcon aiTool="mcode" />);

    // Assert — the mark is the official app icon (favicon_v2.png on the
    // download page): a fixed-color three-layer icon, not a currentColor
    // monochrome glyph and no gradient.
    expect(container.querySelector("linearGradient")).toBeNull();
    const svgClass = container.querySelector("svg")?.getAttribute("class") ?? "";
    expect(svgClass).not.toContain("text-current");
    const tile = container.querySelector("rect");
    expect(tile?.getAttribute("fill")).toBe("#7DC6FF");
    const paths = Array.from(container.querySelectorAll("path"));
    expect(paths.map((p) => p.getAttribute("fill"))).toEqual(["#FFFFFF", "#000000"]);
    // The glyph is re-centered from the 112×32 docs-logo box onto the tile.
    expect(container.querySelector("g")?.getAttribute("transform")).toBe(
      "translate(2.75 4.584) scale(0.73077) translate(-3.58308 -5.80436)"
    );
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

  it("renders the monochrome prompt mark for terminal sessions", () => {
    // Arrange & Act
    const { container } = render(<CliBrandIcon aiTool="terminal" />);

    // Assert — the ">_" prompt glyph follows the surrounding text color
    // (no fixed fill), so it stays legible in active and inactive tabs alike.
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    const svgClass = svg?.getAttribute("class") ?? "";
    expect(svgClass).toContain("text-current");
    const group = container.querySelector("g");
    expect(group).not.toBeNull();
    expect(group?.getAttribute("fill")).toBe("none");
    expect(group?.getAttribute("stroke")).toBe("currentColor");
    expect(container.querySelectorAll("path").length).toBe(2);
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

  it("scales the PI mark about the box center so it matches the other marks' visual weight", () => {
    // Arrange & Act
    const { container } = render(<CliBrandIcon aiTool="pi" />);

    // Assert — the official π mark only fills ~59% of the 24×24 viewBox;
    // the group transform scales it up about the center (12,12).
    const group = container.querySelector("svg > g");
    expect(group?.getAttribute("transform")).toBe(
      "translate(12 12) scale(1.45) translate(-12 -12)"
    );
    expect(group?.querySelectorAll("path").length).toBe(3);
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
