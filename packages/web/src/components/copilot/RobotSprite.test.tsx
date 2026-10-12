// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { RobotSprite } from "./RobotSprite";

afterEach(cleanup);

it("loads only the requested action and reuses its sheet for subsequent frames", () => {
  const { container, rerender } = render(<RobotSprite petId="robot" frame="stand" />);
  const idle = container.querySelector("img")!;
  expect(idle.getAttribute("src")).toBe("/pets/fb01/stand.webp");
  fireEvent.load(idle);
  rerender(<RobotSprite petId="robot" frame="blink" />);
  expect(container.querySelector("img")).toBe(idle);
  expect(idle.style.transform).toBe("translateX(-50%)");
  rerender(<RobotSprite petId="robot" frame="sit1" />);
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
  const { container, rerender } = render(<RobotSprite petId="robot" frame="walk1" flip />);
  fireEvent.error(container.querySelector("img")!);
  expect(container.querySelector("svg")).not.toBeNull();
  expect(container.querySelector("svg")!.style.transform).toBe("scaleX(-1)");
  rerender(<RobotSprite petId="robot" frame="stand" />);
  expect(container.querySelector("img")!.getAttribute("src")).toBe("/pets/fb01/stand.webp");
});

it("crops all eight honey-badger walk poses from the same decoded strip", () => {
  const { container, rerender } = render(<RobotSprite frame="walk1" />);
  const strip = container.querySelector("img")!;
  expect(strip.getAttribute("src")).toBe("/pets/honey-badger-v3/walk.webp");
  expect(strip.getAttribute("width")).toBe("1536");
  fireEvent.load(strip);
  rerender(<RobotSprite frame="walk8" />);
  expect(container.querySelector("img")).toBe(strip);
  expect(strip.style.transform).toBe("translateX(-87.5%)");
  expect(strip.style.visibility).toBe("visible");
});

it("uses the half-blink and full-blink cells in the honey-badger sit strip", () => {
  const { container, rerender } = render(<RobotSprite frame="sitHalfBlink" />);
  const strip = container.querySelector("img")!;
  fireEvent.load(strip);
  expect(strip.getAttribute("src")).toBe("/pets/honey-badger-v3/sit.webp");
  expect(strip.style.transform).toBe("translateX(-75%)");
  rerender(<RobotSprite frame="sitBlink" />);
  expect(container.querySelector("img")).toBe(strip);
  expect(strip.style.transform).toBe("translateX(-87.5%)");
});

it("decodes a new pet separately and maps expanded frames to the local fallback", () => {
  const { container, rerender } = render(<RobotSprite petId="robot" frame="stand" />);
  fireEvent.load(container.querySelector("img")!);
  rerender(<RobotSprite petId="honey-badger" frame="stand" />);
  expect(container.querySelector("img")!.style.visibility).toBe("hidden");
  expect(container.querySelector("span")!.style.backgroundImage).toContain("honey-badger-v3/stand.webp");
  rerender(<RobotSprite frame="walk7" />);
  fireEvent.error(container.querySelector("img")!);
  expect(container.querySelector("svg")).not.toBeNull();
});
