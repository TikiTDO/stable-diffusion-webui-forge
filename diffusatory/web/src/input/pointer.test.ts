import { describe, expect, it } from "vitest";

import type { PointerEventLike } from "./pointer";
import { normalizePointerSample, pointerSamples } from "./pointer";

function pointer(
  patch: Partial<PointerEventLike> = {},
): PointerEventLike {
  return {
    pointerId: 7,
    pointerType: "pen",
    clientX: 25,
    clientY: 40,
    pressure: 0.35,
    tiltX: 12,
    tiltY: -8,
    button: 0,
    buttons: 1,
    timeStamp: 100,
    ...patch,
  };
}

describe("pointer normalization", () => {
  it("maps browser input into image space without losing pen channels", () => {
    const sample = normalizePointerSample(pointer({ twist: 42 }), "move", (x, y) => ({
      x: (x - 5) * 2,
      y: (y - 10) * 2,
    }));

    expect(sample).toEqual({
      pointerId: 7,
      kind: "pen",
      phase: "move",
      imageX: 40,
      imageY: 60,
      pressure: 0.35,
      tiltX: 12,
      tiltY: -8,
      twist: 42,
      tangentialPressure: null,
      button: 0,
      buttons: 1,
      timestamp: 100,
    });
  });

  it("uses coalesced movement samples without duplicating the wrapper event", () => {
    const event = pointer({
      clientX: 99,
      getCoalescedEvents: () => [
        pointer({ clientX: 20, timeStamp: 98 }),
        pointer({ clientX: 22, timeStamp: 99 }),
      ],
    });

    const samples = pointerSamples(event, "move", (x, y) => ({ x, y }));

    expect(samples.map((sample) => sample.imageX)).toEqual([20, 22]);
    expect(samples.map((sample) => sample.timestamp)).toEqual([98, 99]);
  });

  it("does not ask for coalesced samples on a terminal event", () => {
    let called = false;
    const event = pointer({
      getCoalescedEvents: () => {
        called = true;
        return [];
      },
    });

    expect(pointerSamples(event, "up", (x, y) => ({ x, y }))).toHaveLength(1);
    expect(called).toBe(false);
  });

  it("bounds malformed device channels", () => {
    const sample = normalizePointerSample(
      pointer({ pressure: 3, tiltX: -120, tiltY: 120, tangentialPressure: -4 }),
      "down",
      (x, y) => ({ x, y }),
    );

    expect(sample.pressure).toBe(1);
    expect(sample.tiltX).toBe(-90);
    expect(sample.tiltY).toBe(90);
    expect(sample.tangentialPressure).toBe(-1);
  });
});

