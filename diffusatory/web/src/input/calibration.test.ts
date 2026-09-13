import { describe, expect, it } from "vitest";

import { calibratePressure, representativePressure } from "./calibration";

describe("pressure calibration", () => {
  const calibration = {
    inputMinimum: 0.1,
    inputMaximum: 0.9,
    outputMinimum: 0.05,
    outputMaximum: 0.8,
    curve: 1,
  };

  it("preserves a visible light-stroke floor", () => {
    expect(calibratePressure(0.1, calibration)).toBeCloseTo(0.05);
    expect(calibratePressure(0.5, calibration)).toBeCloseTo(0.425);
    expect(calibratePressure(0.9, calibration)).toBeCloseTo(0.8);
  });

  it("clamps readings outside the observed pressure range", () => {
    expect(calibratePressure(-1, calibration)).toBeCloseTo(0.05);
    expect(calibratePressure(2, calibration)).toBeCloseTo(0.8);
  });

  it("supports a deliberately softer response curve", () => {
    expect(
      calibratePressure(0.3, { ...calibration, curve: 0.5 }),
    ).toBeGreaterThan(calibratePressure(0.3, calibration));
  });

  it("keeps a finite range when a malformed profile puts both ends at one", () => {
    expect(
      calibratePressure(1, {
        ...calibration,
        inputMinimum: 1,
        inputMaximum: 1,
      }),
    ).toBeCloseTo(0.8);
  });
});

describe("pressure capture", () => {
  it("uses the median nonzero reading instead of one noisy peak", () => {
    expect(representativePressure([0, 0.12, 0.13, 0.14, 0.9])).toBe(0.135);
  });

  it("does not manufacture pen pressure from an empty stroke", () => {
    expect(representativePressure([0, Number.NaN])).toBeNull();
  });
});
