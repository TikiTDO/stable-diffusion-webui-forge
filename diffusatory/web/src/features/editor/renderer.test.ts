import { describe, expect, it } from "vitest";

import { DEFAULT_PRESSURE_CALIBRATION } from "../../input/calibration";
import type { PointerSample } from "../../input/pointer";
import { createStrokeOperation } from "./model";
import { brushFootprint, paintStrokeSamples } from "./renderer";

function sample(patch: Partial<PointerSample> = {}): PointerSample {
  return {
    pointerId: 1,
    kind: "pen",
    phase: "move",
    imageX: 10,
    imageY: 10,
    pressure: 1,
    tiltX: 0,
    tiltY: 0,
    altitudeAngle: null,
    azimuthAngle: null,
    twist: null,
    tangentialPressure: null,
    button: 0,
    buttons: 1,
    timestamp: 0,
    ...patch,
  };
}

const operation = createStrokeOperation({
  layer: "paint",
  erase: false,
  color: "#fff",
  size: 40,
  opacity: 1,
  pressure: DEFAULT_PRESSURE_CALIBRATION,
});

describe("pen brush footprint", () => {
  it("keeps an upright pen round", () => {
    expect(brushFootprint(sample(), operation)).toMatchObject({
      radiusX: 20,
      radiusY: 20,
    });
  });

  it("turns pen altitude and azimuth into an oriented elliptical mark", () => {
    const footprint = brushFootprint(
      sample({ altitudeAngle: Math.PI / 6, azimuthAngle: Math.PI / 3 }),
      operation,
    );
    expect(footprint.radiusX).toBe(20);
    expect(footprint.radiusY).toBeLessThan(13);
    expect(footprint.rotation).toBeCloseTo(Math.PI / 3);
  });

  it("falls back to legacy tilt and barrel twist reports", () => {
    const footprint = brushFootprint(sample({ tiltX: 60, twist: 90 }), operation);
    expect(footprint.radiusY).toBeLessThan(footprint.radiusX);
    expect(footprint.rotation).toBeCloseTo(Math.PI / 2);
  });

  it("uses pressure for footprint without fading the stroke", () => {
    const seenAlpha: number[] = [];
    let currentAlpha = 1;
    const context = {
      get globalAlpha() {
        return currentAlpha;
      },
      set globalAlpha(value: number) {
        currentAlpha = value;
      },
      fillStyle: "",
      strokeStyle: "",
      lineCap: "butt",
      lineJoin: "miter",
      globalCompositeOperation: "source-over",
      save: () => undefined,
      restore: () => undefined,
      beginPath: () => undefined,
      ellipse: () => undefined,
      fill() {
        seenAlpha.push(currentAlpha);
      },
    } as unknown as CanvasRenderingContext2D;
    const faintPressure = createStrokeOperation({
      layer: operation.layer,
      erase: operation.erase,
      color: operation.color,
      size: operation.size,
      opacity: 0.75,
      pressure: operation.pressure,
    });
    faintPressure.samples.push(sample({ pressure: 0.1 }));

    paintStrokeSamples(context, faintPressure);

    expect(seenAlpha).toEqual([0.75]);
    expect(brushFootprint(faintPressure.samples[0], faintPressure).radiusX).toBeLessThan(
      operation.size / 2,
    );
  });
});
