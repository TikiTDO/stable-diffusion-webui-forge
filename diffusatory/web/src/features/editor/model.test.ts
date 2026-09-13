import { describe, expect, it } from "vitest";

import {
  brushControlFromSize,
  brushSizeFromControl,
  createStrokeOperation,
} from "./model";

describe("editor brush scale", () => {
  it("uses a useful logarithmic range instead of making the midpoint enormous", () => {
    expect(brushSizeFromControl(0)).toBe(1);
    expect(brushSizeFromControl(50)).toBe(16);
    expect(brushSizeFromControl(100)).toBe(256);
  });

  it("round-trips common image-space sizes", () => {
    for (const size of [1, 4, 16, 64, 256]) {
      expect(brushSizeFromControl(brushControlFromSize(size))).toBe(size);
    }
  });

  it("snapshots pressure calibration into each stroke", () => {
    const pressure = {
      inputMinimum: 0.1,
      inputMaximum: 0.8,
      outputMinimum: 0.05,
      outputMaximum: 1,
      curve: 1,
    };
    const stroke = createStrokeOperation({
      layer: "paint",
      erase: false,
      color: "#000000",
      size: 16,
      opacity: 1,
      pressure,
    });

    pressure.curve = 2;

    expect(stroke.pressure.curve).toBe(1);
    expect(stroke.samples).toEqual([]);
  });
});
