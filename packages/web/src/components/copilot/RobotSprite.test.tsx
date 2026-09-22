// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { RobotSprite } from "./RobotSprite";

afterEach(cleanup);

it("loads only the requested action and reuses its sheet for subsequent frames", () => {
  const { container, rerender } = render(<RobotSprite frame="stand" />);
  const idle = container.querySelector("img")!;
  expect(idle.getAttribute("src")).toBe("/pets/fb01/stand.webp");
  fireEvent.load(idle);
  rerender(<RobotSprite frame="blink" />);
  expect(container.querySelector("img")).toBe(idle);
  expect(idle.style.transform).toBe("translateX(-50%)");
  rerender(<RobotSprite frame="sit1" />);
  const sitting = container.querySelector("img")!;
  expect(sitting.getAttribute("src")).toBe("/pets/fb01/sit.webp");
  // The already-cached stand image covers the async decode interval.
  expect(sitting.style.visibility).toBe("hidden");
  expect(container.querySelector("span")!.style.backgroundImage).toContain("stand.webp");
  fireEvent.load(sitting);
  expect(sitting.style.visibility).toBe("visible");
  expect(container.querySelector("span")!.style.backgroundImage).toBe("");
});

it("keeps a visible local fallback when an action asset fails", () => {
  const { container, rerender } = render(<RobotSprite frame="walk1" flip />);
  fireEvent.error(container.querySelector("img")!);
  expect(container.querySelector("svg")).not.toBeNull();
  expect(container.querySelector("svg")!.style.transform).toBe("scaleX(-1)");
  rerender(<RobotSprite frame="stand" />);
  expect(container.querySelector("img")!.getAttribute("src")).toBe("/pets/fb01/stand.webp");
});
