import { describe, expect, it } from "vitest";

import {
  bindingMatches,
  captureBindingSignature,
  createTabletProfile,
} from "./bindings";

describe("tablet bindings", () => {
  it("records the event signature the browser actually produced", () => {
    expect(
      captureBindingSignature({ pointerType: "pen", button: 5, buttons: 32 }),
    ).toEqual({ kind: "pen", button: 5, buttons: 32 });
  });

  it("matches press and release by changed button rather than live bitmask", () => {
    const binding = {
      action: "toggle-paint-mask" as const,
      behavior: "toggle" as const,
      signature: { kind: "pen" as const, button: 2, buttons: 2 },
    };

    expect(
      bindingMatches(binding, { pointerType: "pen", button: 2 }),
    ).toBe(true);
    expect(
      bindingMatches(binding, { pointerType: "mouse", button: 2 }),
    ).toBe(false);
  });

  it("creates a named, serializable profile without claiming a device ID", () => {
    expect(createTabletProfile("  Huion desk  ")).toEqual({
      schemaVersion: 1,
      name: "Huion desk",
      bindings: [],
      pressure: {
        inputMinimum: 0.02,
        inputMaximum: 0.85,
        outputMinimum: 0.08,
        outputMaximum: 1,
        curve: 1,
      },
    });
  });
});
