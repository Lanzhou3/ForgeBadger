import { describe, expect, it } from "vitest";

import {
  CORNER_MARGIN_PX,
  PIXEL_GRID_SIZE,
  PIXEL_PALETTE_KEYS,
  ROBOT_FRAMES,
  ROBOT_SIZE_PX,
  bubblePlacement,
  cornerOffsetPosition,
  isRobotCorner,
  nearestCorner,
  pixelFrameIsValid,
  type RobotFrameKey,
} from "./pixel-robot";

const frameKeys: RobotFrameKey[] = ["stand", "blink", "walk1", "walk2", "sit1", "sit2", "sitBlink"];

describe("pixel robot frames", () => {
  it("defines a 20x20 grid for every frame", () => {
    // Arrange / Act / Assert
    for (const key of frameKeys) {
      const frame = ROBOT_FRAMES[key];
      expect(frame).toHaveLength(PIXEL_GRID_SIZE);
      for (const row of frame) {
        expect(row).toHaveLength(PIXEL_GRID_SIZE);
      }
    }
  });

  it("only uses declared palette characters", () => {
    // Arrange
    const allowed = new Set([".", ...PIXEL_PALETTE_KEYS]);

    // Act / Assert
    for (const key of frameKeys) {
      for (const row of ROBOT_FRAMES[key]) {
        for (const cell of row) {
          expect(allowed.has(cell)).toBe(true);
        }
      }
    }
  });

  it("accepts all bundled frames as valid and rejects malformed grids", () => {
    // Arrange / Act / Assert
    for (const key of frameKeys) {
      expect(pixelFrameIsValid(ROBOT_FRAMES[key])).toBe(true);
    }
    expect(pixelFrameIsValid(["too short"])).toBe(false);
    expect(pixelFrameIsValid(Array(PIXEL_GRID_SIZE).fill("X".repeat(PIXEL_GRID_SIZE)))).toBe(false);
  });

  it("gives the blink frame a distinct closed-eye row from the stand frame", () => {
    // Arrange / Act / Assert
    expect(ROBOT_FRAMES.blink).not.toEqual(ROBOT_FRAMES.stand);
    expect(ROBOT_FRAMES.blink.filter((row, index) => row !== ROBOT_FRAMES.stand[index])).toHaveLength(1);
  });

  it("gives the sit-blink frame a distinct closed-eye row from the sit1 frame", () => {
    // Arrange / Act / Assert
    expect(ROBOT_FRAMES.sitBlink).not.toEqual(ROBOT_FRAMES.sit1);
    expect(ROBOT_FRAMES.sitBlink.filter((row, index) => row !== ROBOT_FRAMES.sit1[index])).toHaveLength(1);
  });
});

describe("nearestCorner", () => {
  it("maps viewport quadrants to corners", () => {
    // Arrange
    const viewport = { width: 1000, height: 800 };

    // Act / Assert
    expect(nearestCorner(10, 10, viewport)).toBe("top-left");
    expect(nearestCorner(900, 10, viewport)).toBe("top-right");
    expect(nearestCorner(10, 700, viewport)).toBe("bottom-left");
    expect(nearestCorner(900, 700, viewport)).toBe("bottom-right");
  });

  it("snaps points near a corner to that corner", () => {
    // Arrange
    const viewport = { width: 1280, height: 720 };

    // Act / Assert
    expect(nearestCorner(1200, 640, viewport)).toBe("bottom-right");
    expect(nearestCorner(40, 680, viewport)).toBe("bottom-left");
  });
});

describe("bubblePlacement", () => {
  it("places the bubble on the robot's left when the robot sits at a right corner", () => {
    // Arrange / Act / Assert
    expect(bubblePlacement("bottom-right")).toEqual({ side: "left", vertical: "above" });
    expect(bubblePlacement("top-right")).toEqual({ side: "left", vertical: "below" });
  });

  it("places the bubble on the robot's right when the robot sits at a left corner", () => {
    // Arrange / Act / Assert
    expect(bubblePlacement("bottom-left")).toEqual({ side: "right", vertical: "above" });
    expect(bubblePlacement("top-left")).toEqual({ side: "right", vertical: "below" });
  });
});

describe("cornerOffsetPosition", () => {
  it("pins the robot inside the corner with the configured margin", () => {
    // Arrange
    const viewport = { width: 1000, height: 800 };

    // Act / Assert
    expect(cornerOffsetPosition("bottom-right", viewport, ROBOT_SIZE_PX, CORNER_MARGIN_PX)).toEqual({
      x: 1000 - ROBOT_SIZE_PX - CORNER_MARGIN_PX,
      y: 800 - ROBOT_SIZE_PX - CORNER_MARGIN_PX,
    });
    expect(cornerOffsetPosition("top-left", viewport, ROBOT_SIZE_PX, CORNER_MARGIN_PX)).toEqual({
      x: CORNER_MARGIN_PX,
      y: CORNER_MARGIN_PX,
    });
  });
});

describe("isRobotCorner", () => {
  it("accepts valid corners and rejects anything else", () => {
    // Arrange / Act / Assert
    expect(isRobotCorner("bottom-right")).toBe(true);
    expect(isRobotCorner("middle")).toBe(false);
    expect(isRobotCorner(null)).toBe(false);
  });
});
