import { describe, expect, it } from "vitest";

import { resolveWheelAction } from "./terminal-scroll";

describe("terminal scroll wheel handling", () => {
  it("suppresses the wheel when the app is on the alternate screen and mouse events are inactive", () => {
    expect(resolveWheelAction("alternate", false)).toBe("suppress");
  });

  it("allows the wheel when the app is on the alternate screen and mouse events are active", () => {
    expect(resolveWheelAction("alternate", true)).toBe("allow");
  });

  it("allows the wheel on the normal buffer when mouse events are inactive", () => {
    expect(resolveWheelAction("normal", false)).toBe("allow");
  });

  it("allows the wheel on the normal buffer when mouse events are active", () => {
    expect(resolveWheelAction("normal", true)).toBe("allow");
  });
});
